import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildAnchorlessRetry,
  buildIssueComment,
  buildPostRequest,
  buildReviewPayload,
  parseAnchors,
  publish,
} from '../publish-review.mjs'

const HEAD = 'b'.repeat(40)

const DIFF = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,0 +11,2 @@
+added one
+added two
@@ -20,2 +22,0 @@ function gone() {
-removed one
-removed two
diff --git a/docs/readme.md b/docs/readme.md
--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1 +1 @@
-old
+new
`

function review(overrides = {}) {
  return {
    body: 'Итог ревью: изменение небольшое.',
    comments: [
      {
        path: 'src/app.js',
        line: 11,
        side: 'RIGHT',
        body: 'REV-1: добавленная строка не проверяется.',
      },
    ],
    ...overrides,
  }
}

function build(overrides = {}) {
  return buildReviewPayload({
    review: 'review' in overrides ? overrides.review : review(),
    diff: overrides.diff ?? DIFF,
    headSha: overrides.headSha ?? HEAD,
    currentHeadSha: overrides.currentHeadSha ?? HEAD,
    runUrl: overrides.runUrl ?? 'https://github.com/acme/app/actions/runs/7',
    pr: overrides.pr ?? 26,
  })
}

test('a valid report becomes one COMMENT review with body and inline comments', () => {
  const result = build()
  assert.equal(result.status, 'ready')
  assert.equal(result.inlineCount, 1)
  assert.deepEqual(result.moved, [])
  const { payload } = result
  assert.equal(payload.event, 'COMMENT')
  assert.equal(payload.commit_id, HEAD)
  assert.deepEqual(payload.comments, [
    {
      path: 'src/app.js',
      line: 11,
      side: 'RIGHT',
      body: 'REV-1: добавленная строка не проверяется.',
    },
  ])
  assert.match(payload.body, /Итог ревью/)
  assert.match(payload.body, new RegExp(`Reviewed-SHA: \\\`${HEAD}\\\``))
  assert.match(payload.body, new RegExp(`reviewed@${HEAD}`))
  assert.match(
    payload.body,
    /https:\/\/github\.com\/acme\/app\/actions\/runs\/7/,
  )
})

test('an unanchorable comment moves into the review body instead of disappearing', () => {
  const result = build({
    review: review({
      comments: [
        {
          path: 'src/app.js',
          line: 999,
          side: 'RIGHT',
          body: 'REV-2: строка вне diff.',
        },
        {
          path: 'src/gone.js',
          line: 3,
          side: 'RIGHT',
          body: 'REV-3: файла нет в diff.',
        },
      ],
    }),
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.inlineCount, 0)
  assert.equal(result.moved.length, 2)
  assert.deepEqual(result.payload.comments, [])
  assert.match(result.payload.body, /src\/app\.js:999/)
  assert.match(result.payload.body, /REV-2: строка вне diff\./)
  assert.match(result.payload.body, /src\/gone\.js:3/)
  assert.match(result.payload.body, /REV-3: файла нет в diff\./)
})

test('a mixed report keeps valid anchors inline and moves only invalid ones', () => {
  const result = build({
    review: review({
      comments: [
        { path: 'src/app.js', line: 11, side: 'RIGHT', body: 'REV-6 inline' },
        { path: 'src/app.js', line: 900, side: 'RIGHT', body: 'REV-7 moved' },
      ],
    }),
  })
  assert.equal(result.inlineCount, 1)
  assert.equal(result.moved.length, 1)
  assert.deepEqual(
    result.payload.comments.map((comment) => comment.body),
    ['REV-6 inline'],
  )
  assert.match(result.payload.body, /REV-7 moved/)
})

test('LEFT-side deletion anchors are accepted', () => {
  const result = build({
    review: review({
      comments: [{ path: 'src/app.js', line: 21, side: 'LEFT', body: 'REV-4' }],
    }),
  })
  assert.equal(result.inlineCount, 1)
  assert.deepEqual(result.payload.comments, [
    { path: 'src/app.js', line: 21, side: 'LEFT', body: 'REV-4' },
  ])
})

test('a comment without a side defaults to the RIGHT side', () => {
  const result = build({
    review: review({
      comments: [{ path: 'docs/readme.md', line: 1, body: 'REV-5' }],
    }),
  })
  assert.equal(result.inlineCount, 1)
  assert.equal(result.payload.comments[0].side, 'RIGHT')
})

test('the review event is always COMMENT, even when the model asks to approve', () => {
  const result = build({ review: review({ event: 'APPROVE' }) })
  assert.equal(result.payload.event, 'COMMENT')
  assert.doesNotMatch(
    JSON.stringify(result.payload),
    /APPROVE|REQUEST_CHANGES/,
  )
})

test('a stale head SHA is refused instead of publishing an outdated review', () => {
  const result = build({ currentHeadSha: 'c'.repeat(40) })
  assert.equal(result.status, 'stale-head')
  assert.equal(result.headSha, HEAD)
  assert.equal(result.currentHeadSha, 'c'.repeat(40))
  assert.equal(result.payload, undefined)
})

test('an empty report is invalid and never published', () => {
  for (const value of [null, 'text', [], { comments: 'x' }]) {
    const result = build({ review: value })
    assert.equal(result.status, 'invalid-report', String(value))
    assert.equal(result.payload, undefined)
  }
})

test('the 422 fallback drops anchors but keeps every finding in the body', () => {
  const { payload } = build()
  const retry = buildAnchorlessRetry(payload)
  assert.equal(retry.event, 'COMMENT')
  assert.equal(retry.commit_id, HEAD)
  assert.deepEqual(retry.comments, [])
  assert.match(retry.body, /src\/app\.js:11/)
  assert.match(retry.body, /REV-1: добавленная строка не проверяется\./)
  assert.match(retry.body, new RegExp(`Reviewed-SHA: \\\`${HEAD}\\\``))

  const fallback = buildIssueComment(payload)
  assert.deepEqual(Object.keys(fallback), ['body'])
  assert.match(fallback.body, /REV-1: добавленная строка не проверяется\./)
  assert.match(fallback.body, new RegExp(`reviewed@${HEAD}`))
})

test('anchors are parsed per file and per side from a unified=0 diff', () => {
  const anchors = parseAnchors(DIFF)
  assert.deepEqual([...anchors.get('src/app.js').right], [11, 12])
  assert.deepEqual([...anchors.get('src/app.js').left], [20, 21])
  assert.deepEqual([...anchors.get('docs/readme.md').right], [1])
  assert.deepEqual([...anchors.get('docs/readme.md').left], [1])
})

test('diff content that looks like a file header stays content', () => {
  const anchors = parseAnchors(`diff --git a/notes.txt b/notes.txt
--- a/notes.txt
+++ b/notes.txt
@@ -1,0 +2,2 @@
+++ not a file header
+normal line
@@ -5,2 +7,0 @@
--- not a file header
-removed line
`)
  assert.deepEqual([...anchors.keys()], ['notes.txt'])
  assert.deepEqual([...anchors.get('notes.txt').right], [2, 3])
  assert.deepEqual([...anchors.get('notes.txt').left], [5, 6])
})

test('quoted diff paths keep their inline anchors', () => {
  const anchors =
    parseAnchors(`diff --git "a/dir/file with space.txt" "b/dir/file with space.txt"
--- "a/dir/file with space.txt"
+++ "b/dir/file with space.txt"
@@ -0,0 +1,2 @@
+one
+two
diff --git "a/caf\\303\\251.md" "b/caf\\303\\251.md"
--- "a/caf\\303\\251.md"
+++ "b/caf\\303\\251.md"
@@ -0,0 +1 @@
+new
`)
  assert.deepEqual([...anchors.get('dir/file with space.txt').right], [1, 2])
  assert.deepEqual([...anchors.get('café.md').right], [1])
})

test('the publish path retries without anchors, then falls back to a comment', async () => {
  const { payload } = build()

  const success = await publish(
    { payload },
    { repository: 'acme/app', pr: 26, post: () => ({ status: 0 }) },
  )
  assert.equal(success, 'review')

  const calls = []
  const responses = [
    { status: 1, stderr: 'gh: Validation Failed (HTTP 422)' },
    { status: 0 },
  ]
  const retry = await publish(
    { payload },
    {
      repository: 'acme/app',
      pr: 26,
      post: (endpoint, body, repository) => {
        calls.push({ endpoint, body, repository })
        return responses.shift()
      },
    },
  )
  assert.equal(retry, 'review-without-anchors')
  assert.equal(calls[0].endpoint, 'pulls/26/reviews')
  assert.equal(calls[0].repository, 'acme/app')
  assert.equal(calls[1].endpoint, 'pulls/26/reviews')
  assert.deepEqual(calls[1].body.comments, [])
  assert.equal(calls[1].body.commit_id, HEAD)
  assert.match(
    calls[1].body.body,
    /REV-1: добавленная строка не проверяется\./,
  )

  const fallbackCalls = []
  const fallbackResponses = [
    { status: 1, stderr: 'Validation Failed (422)' },
    { status: 1, stderr: 'Validation Failed (422)' },
    { status: 0 },
  ]
  const fallback = await publish(
    { payload },
    {
      repository: 'acme/app',
      pr: 26,
      post: (endpoint, body) => {
        fallbackCalls.push({ endpoint, body })
        return fallbackResponses.shift()
      },
    },
  )
  assert.equal(fallback, 'issue-comment')
  assert.equal(fallbackCalls[2].endpoint, 'issues/26/comments')
  assert.deepEqual(Object.keys(fallbackCalls[2].body), ['body'])
  assert.match(fallbackCalls[2].body.body, /REV-1/)
  assert.match(fallbackCalls[2].body.body, /reviewed@/)
})

test('a non-422 publishing error is not retried or downgraded', async () => {
  const { payload } = build()
  let calls = 0
  await assert.rejects(
    publish(
      { payload },
      {
        repository: 'acme/app',
        pr: 26,
        post: () => {
          calls += 1
          return {
            status: 1,
            stderr: 'gh: Resource not accessible (HTTP 403)',
          }
        },
      },
    ),
    /Cannot publish review/,
  )
  assert.equal(calls, 1)
})

test('--post builds the exact gh api invocation for the review endpoint', () => {
  const request = buildPostRequest(
    'pulls/26/reviews',
    { event: 'COMMENT', body: 'x' },
    'acme/app',
  )
  assert.deepEqual(request.args, [
    'api',
    '--method',
    'POST',
    'repos/acme/app/pulls/26/reviews',
    '--input',
    '-',
  ])
  assert.deepEqual(JSON.parse(request.input), { event: 'COMMENT', body: 'x' })
})

test('a deleted file has no RIGHT anchors', () => {
  const anchors = parseAnchors(`diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`)
  assert.equal(anchors.has('/dev/null'), false)
  assert.deepEqual(
    [...anchors.values()].flatMap((a) => [...a.right]),
    [],
  )
  assert.deepEqual(
    [...anchors.values()].flatMap((a) => [...a.left]),
    [1, 2],
  )
})

test('the CLI prints a ready payload and a stale-head refusal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'publish-review-'))
  try {
    const reviewPath = join(directory, 'review.json')
    const diffPath = join(directory, 'diff.txt')
    await writeFile(reviewPath, JSON.stringify(review()))
    await writeFile(diffPath, DIFF)
    const baseArgs = [
      'scripts/publish-review.mjs',
      '--review',
      reviewPath,
      '--diff',
      diffPath,
      '--head',
      HEAD,
      '--pr',
      '26',
      '--run-url',
      'https://github.com/acme/app/actions/runs/7',
    ]
    const ready = spawnSync(
      process.execPath,
      [...baseArgs, '--current-head', HEAD],
      { encoding: 'utf8' },
    )
    assert.equal(ready.status, 0, ready.stderr)
    const readyOutput = JSON.parse(ready.stdout)
    assert.equal(readyOutput.status, 'ready')
    assert.equal(readyOutput.payload.comments.length, 1)

    const stale = spawnSync(
      process.execPath,
      [...baseArgs, '--current-head', 'd'.repeat(40)],
      { encoding: 'utf8' },
    )
    assert.equal(stale.status, 3)
    assert.equal(JSON.parse(stale.stdout).status, 'stale-head')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the CLI exits non-zero for unusable input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'publish-review-'))
  try {
    const diffPath = join(directory, 'diff.txt')
    const broken = join(directory, 'broken.json')
    await writeFile(diffPath, DIFF)
    await writeFile(broken, '{not json')
    const cases = [
      [],
      ['--review', broken],
      [
        '--review',
        broken,
        '--diff',
        join(directory, 'missing.diff'),
        '--head',
        HEAD,
        '--pr',
        '26',
        '--current-head',
        HEAD,
      ],
      [
        '--review',
        broken,
        '--diff',
        diffPath,
        '--head',
        HEAD,
        '--pr',
        '26',
        '--current-head',
        HEAD,
      ],
      ['--review', broken, '--unknown', 'x'],
    ]
    for (const args of cases) {
      const result = spawnSync(
        process.execPath,
        ['scripts/publish-review.mjs', ...args],
        { encoding: 'utf8' },
      )
      assert.notEqual(result.status, 0, args.join(' '))
      assert.equal(result.stdout.trim(), '', args.join(' '))
      assert.match(result.stderr, /\S/, args.join(' '))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
