#!/usr/bin/env node
// Decide whether a pull-request review attempt may call the model.
// Attempts are reserved by posting a hidden marker comment, so the pure
// decision counts markers instead of workflow runs: a run cancelled before it
// posted the marker never spends the limit, a run cancelled after it did.
// The CLI reads JSON (file or stdin) and prints the decision; it only exits
// non-zero when the input itself is unusable, never for a denial.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const LIMIT = 5

const MARKER =
  /<!--\s*review-run-limit\s+pr=(\d+)\s+run=([^\s]+)\s+sha=([0-9a-fA-F]{7,64})\s*-->/g
const SAFE_RUN = /^[A-Za-z0-9._-]+$/

// Only the workflow's own bot identities may reserve attempts. Any commenter
// can post a well-formed marker, so counting every body would let an external
// user forge hidden markers and burn the limit (DoS on auto-review).
export const TRUSTED_AUTHORS = Object.freeze([
  'github-actions[bot]',
  'opencode-agent[bot]',
])

export function buildMarker({ pr, run, sha }) {
  if (!Number.isInteger(pr) || pr <= 0)
    throw new TypeError('pr must be a positive integer')
  if (typeof run !== 'string' || !SAFE_RUN.test(run))
    throw new TypeError('run must be an identifier such as <run-id>.<attempt>')
  if (typeof sha !== 'string' || !/^[0-9a-fA-F]{7,64}$/.test(sha))
    throw new TypeError('sha must be a hexadecimal commit SHA')
  return `<!-- review-run-limit pr=${pr} run=${run} sha=${sha} -->`
}

function commentBody(comment) {
  if (comment && typeof comment === 'object') return comment.body
  return undefined
}

function isTrustedAuthor(comment) {
  return (
    comment !== null &&
    typeof comment === 'object' &&
    TRUSTED_AUTHORS.includes(comment.author)
  )
}

export function parseMarkers(comments) {
  const markers = []
  for (const comment of comments) {
    // Markers from users, other bots and comments without an author are
    // untrusted and never consume the limit.
    if (!isTrustedAuthor(comment)) continue
    const body = commentBody(comment)
    if (typeof body !== 'string') continue
    for (const match of body.matchAll(MARKER)) {
      markers.push({
        pr: Number(match[1]),
        run: match[2],
        sha: match[3],
      })
    }
  }
  return markers
}

function errorDecision(reason, detail) {
  return {
    decision: 'error',
    reason,
    ...(detail === undefined ? {} : { detail }),
    limit: LIMIT,
    count: null,
    markers: [],
  }
}

export function decideReviewRun({ pr, run, sha, comments, apiError }) {
  if (apiError !== undefined && apiError !== null) {
    return errorDecision('github-api', String(apiError))
  }
  if (!Number.isInteger(pr) || pr <= 0) return errorDecision('invalid-pr')
  if (typeof run !== 'string' || !run || !SAFE_RUN.test(run))
    return errorDecision('invalid-run')
  if (typeof sha !== 'string' || !/^[0-9a-fA-F]{7,64}$/.test(sha))
    return errorDecision('invalid-sha')
  if (!Array.isArray(comments)) return errorDecision('comments-unavailable')

  const markers = parseMarkers(comments).filter((m) => m.pr === pr)
  const attempts = new Set(markers.map((m) => m.run))
  // The reservation marker of the current attempt is normally absent: the
  // list was fetched before posting it. Count it either way, conservatively.
  const count = attempts.has(run) ? attempts.size : attempts.size + 1

  if (count > LIMIT) {
    return {
      decision: 'limit-reached',
      reason: 'limit-reached',
      limit: LIMIT,
      count,
      pr,
      run,
      sha,
      markers,
    }
  }

  return {
    decision: 'allow',
    limit: LIMIT,
    count,
    pr,
    run,
    sha,
    markers,
    marker: buildMarker({ pr, run, sha }),
  }
}

function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag !== '--input')
      throw new Error('Usage: review-run-limit.mjs [--input FILE]')
    const value = argv[index + 1]
    if (!value) throw new Error('Usage: review-run-limit.mjs [--input FILE]')
    values.input = value
    index += 1
  }
  return values
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function readInput(input) {
  const source = input ? await readFile(input, 'utf8') : await readStdin()
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(`Cannot parse review run limit JSON: ${error.message}`, {
      cause: error,
    })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Review run limit JSON must be an object')
  return parsed
}

async function main() {
  const { input } = parseArguments(process.argv.slice(2))
  const decision = decideReviewRun(await readInput(input))
  process.stdout.write(`${JSON.stringify(decision)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`review-run-limit: ${error.message}\n`)
    process.exit(2)
  })
}
