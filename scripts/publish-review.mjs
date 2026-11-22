#!/usr/bin/env node
// Turn the reviewer model output into a single GitHub pull-request review.
// The pure builders validate inline anchors against the unified=0 diff and
// refuse stale heads; the CLI optionally posts through `gh api --input`.
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const REVIEW_EVENT = 'COMMENT'

function stripDiffPrefix(path) {
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path
}

// git C-quotes paths that contain spaces, quotes, backslashes or non-ASCII
// bytes: `--- "a/dir/file with space.txt"`. Undo that before comparing the
// header with a comment path.
function unquotePath(value) {
  if (!(value.startsWith('"') && value.endsWith('"')) || value.length < 2)
    return value
  const body = value.slice(1, -1)
  const escapes = {
    n: '\n',
    t: '\t',
    r: '\r',
    '"': '"',
    '\\': '\\',
    a: '\x07',
    b: '\b',
    f: '\f',
    v: '\v',
  }
  let result = ''
  const bytes = []
  const flush = () => {
    if (!bytes.length) return
    result += new TextDecoder().decode(Uint8Array.from(bytes))
    bytes.length = 0
  }
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character !== '\\') {
      flush()
      result += character
      continue
    }
    const next = body[index + 1]
    if (next === undefined) break
    if (Object.hasOwn(escapes, next)) {
      flush()
      result += escapes[next]
      index += 1
      continue
    }
    if (/[0-7]/.test(next)) {
      let octal = next
      while (
        octal.length < 3 &&
        /[0-7]/.test(body[index + 1 + octal.length] ?? '')
      )
        octal += body[index + 1 + octal.length]
      bytes.push(parseInt(octal, 8))
      index += octal.length
      continue
    }
    flush()
    result += next
    index += 1
  }
  flush()
  return result
}

export function parseAnchors(diff) {
  const anchors = new Map()
  let inHeader = false
  let oldPath
  let path
  let oldLine
  let newLine

  function ensure(target) {
    let entry = anchors.get(target)
    if (!entry) {
      entry = { right: new Set(), left: new Set() }
      anchors.set(target, entry)
    }
    return entry
  }

  for (const line of String(diff).split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true
      oldPath = undefined
      path = undefined
      continue
    }
    if (inHeader && line.startsWith('--- ')) {
      const value = unquotePath(line.slice(4).trim())
      oldPath = value === '/dev/null' ? undefined : stripDiffPrefix(value)
      path = undefined
      continue
    }
    if (inHeader && line.startsWith('+++ ')) {
      const value = unquotePath(line.slice(4).trim())
      path = value === '/dev/null' ? oldPath : stripDiffPrefix(value)
      if (path !== undefined) ensure(path)
      continue
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      inHeader = false
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (inHeader || path === undefined) continue
    const entry = ensure(path)
    if (line.startsWith('+')) {
      entry.right.add(newLine)
      newLine += 1
    } else if (line.startsWith('-')) {
      entry.left.add(oldLine)
      oldLine += 1
    } else if (line.startsWith(' ')) {
      oldLine += 1
      newLine += 1
    }
  }
  return anchors
}

function normalizeComment(comment) {
  if (!comment || typeof comment !== 'object') return undefined
  const path = typeof comment.path === 'string' ? comment.path : undefined
  const body = typeof comment.body === 'string' ? comment.body.trim() : ''
  const line = Number.isInteger(comment.line) ? comment.line : undefined
  const side = comment.side === undefined ? 'RIGHT' : comment.side
  if (!path || !body || line === undefined) return undefined
  if (side !== 'LEFT' && side !== 'RIGHT') return undefined
  return { path, line, side, body }
}

function renderComments(comments) {
  return comments
    .map((comment) => `**${comment.path}:${comment.line}** — ${comment.body}`)
    .join('\n\n')
}

function composeBody(body, moved, footer) {
  const parts = []
  if (body.trim()) parts.push(body.trim())
  if (moved.length)
    parts.push(
      `### Замечания вне изменённых строк\n\n${renderComments(moved)}`,
    )
  parts.push(footer)
  return parts.join('\n\n')
}

function footer({ headSha, runUrl }) {
  const lines = [
    `Reviewed-SHA: \`${headSha}\``,
    `Статус: \`reviewed@${headSha}\``,
  ]
  if (runUrl) lines.push(`Запуск ревью: ${runUrl}`)
  return lines.join('\n')
}

export function buildReviewPayload({
  review,
  diff,
  headSha,
  currentHeadSha,
  runUrl,
  pr,
}) {
  if (
    !review ||
    typeof review !== 'object' ||
    Array.isArray(review) ||
    typeof review.body !== 'string'
  )
    return { status: 'invalid-report' }
  if (currentHeadSha !== headSha)
    return { status: 'stale-head', headSha, currentHeadSha, pr }

  const anchors = parseAnchors(diff ?? '')
  const rawComments = Array.isArray(review.comments) ? review.comments : []
  const comments = []
  const moved = []

  for (const raw of rawComments) {
    const comment = normalizeComment(raw)
    const allowed =
      comment &&
      (comment.side === 'RIGHT'
        ? anchors.get(comment.path)?.right.has(comment.line)
        : anchors.get(comment.path)?.left.has(comment.line))
    if (allowed) comments.push(comment)
    else if (comment) moved.push(comment)
    else if (raw && typeof raw === 'object' && typeof raw.body === 'string')
      moved.push({
        path: typeof raw.path === 'string' ? raw.path : '(без файла)',
        line: Number.isInteger(raw.line) ? raw.line : 0,
        side: 'RIGHT',
        body: raw.body.trim(),
      })
  }

  const body = composeBody(review.body, moved, footer({ headSha, runUrl }))
  return {
    status: 'ready',
    inlineCount: comments.length,
    moved,
    payload: {
      commit_id: headSha,
      event: REVIEW_EVENT,
      body,
      comments,
    },
  }
}

// GitHub rejects a whole review when one anchor is invalid (422) and does not
// say which one, so the only safe retry keeps the whole body and drops anchors.
export function buildAnchorlessRetry(payload) {
  const comments = Array.isArray(payload.comments) ? payload.comments : []
  const body = comments.length
    ? `${payload.body}\n\n${renderComments(comments)}`
    : payload.body
  return {
    commit_id: payload.commit_id,
    event: REVIEW_EVENT,
    body,
    comments: [],
  }
}

export function buildIssueComment(payload) {
  const comments = Array.isArray(payload.comments) ? payload.comments : []
  return {
    body: comments.length
      ? `${payload.body}\n\n${renderComments(comments)}`
      : payload.body,
  }
}

function parseArguments(argv) {
  const values = {}
  const known = new Set([
    '--review',
    '--diff',
    '--head',
    '--current-head',
    '--pr',
    '--run-url',
    '--out',
    '--post',
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!known.has(flag)) throw new Error(`Unknown argument ${flag}`)
    if (flag === '--post') {
      values.post = true
      continue
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`Missing value for ${flag}`)
    values[flag.slice(2)] = value
    index += 1
  }
  for (const required of ['review', 'diff', 'head', 'current-head', 'pr'])
    if (!values[required])
      throw new Error(
        'Usage: publish-review.mjs --review FILE --diff FILE --head SHA --current-head SHA --pr N [--run-url URL] [--out FILE] [--post]',
      )
  if (!Number.isInteger(Number(values.pr)))
    throw new Error('--pr must be an integer')
  return values
}

async function readJson(path, label) {
  let source
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path}: ${error.message}`, {
      cause: error,
    })
  }
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`Cannot parse ${label} at ${path}: ${error.message}`, {
      cause: error,
    })
  }
}

function gh(args, input) {
  return spawnSync('gh', args, { encoding: 'utf8', input })
}

export function buildPostRequest(endpoint, payload, repository) {
  return {
    args: [
      'api',
      '--method',
      'POST',
      `repos/${repository}/${endpoint}`,
      '--input',
      '-',
    ],
    input: JSON.stringify(payload),
  }
}

function post(endpoint, payload, repository) {
  const request = buildPostRequest(endpoint, payload, repository)
  return gh(request.args, request.input)
}

export async function publish(result, { repository, pr, post: poster = post }) {
  const reviewPath = `pulls/${pr}/reviews`
  let response = poster(reviewPath, result.payload, repository)
  if (response.status === 0) return 'review'
  const rejected = /422|Validation Failed/.test(
    `${response.stderr ?? ''}${response.stdout ?? ''}`,
  )
  if (!rejected) throw new Error(`Cannot publish review: ${response.stderr}`)
  response = poster(
    reviewPath,
    buildAnchorlessRetry(result.payload),
    repository,
  )
  if (response.status === 0) return 'review-without-anchors'
  response = poster(
    `issues/${pr}/comments`,
    buildIssueComment(result.payload),
    repository,
  )
  if (response.status === 0) return 'issue-comment'
  throw new Error(`Cannot publish review: ${response.stderr}`)
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const review = await readJson(args.review, 'review report')
  const diff = await readFile(args.diff, 'utf8').catch((error) => {
    throw new Error(`Cannot read diff at ${args.diff}: ${error.message}`, {
      cause: error,
    })
  })
  const result = buildReviewPayload({
    review,
    diff,
    headSha: args.head,
    currentHeadSha: args['current-head'],
    runUrl: args['run-url'],
    pr: Number(args.pr),
  })

  if (result.status === 'stale-head') {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(3)
  }
  if (result.status !== 'ready') {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(2)
  }

  if (args.out)
    await writeFile(args.out, `${JSON.stringify(result.payload)}\n`)
  if (args.post) {
    const repository = process.env.GITHUB_REPOSITORY
    if (!repository) throw new Error('GITHUB_REPOSITORY is required to post')
    const mode = await publish(result, { repository, pr: Number(args.pr) })
    process.stdout.write(`${JSON.stringify({ ...result, mode })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`publish-review: ${error.message}\n`)
    process.exit(2)
  })
}
