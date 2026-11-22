import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LIMIT,
  buildMarker,
  decideReviewRun,
  parseMarkers,
} from '../review-run-limit.mjs'

const PR = 26
const SHA = 'a'.repeat(40)
const WORKFLOW_BOT = 'github-actions[bot]'

function marker(pr, run, sha = SHA) {
  return buildMarker({ pr, run, sha })
}

function commentsFor(runs, pr = PR, author = WORKFLOW_BOT) {
  return runs.map((run) => ({
    body: `контекст\n\n${marker(pr, run)}\n`,
    author,
  }))
}

function decide(overrides = {}) {
  return decideReviewRun({
    pr: PR,
    run: '1000.1',
    sha: SHA,
    comments: [],
    ...overrides,
  })
}

test('the review run limit is five attempts per pull request', () => {
  assert.equal(LIMIT, 5)
})

test('repeated attempts are allowed up to five and denied from six', () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = decide({ comments: commentsFor(range(1, attempt - 1)) })
    assert.equal(result.decision, 'allow', `attempt ${attempt}`)
    assert.equal(result.count, attempt, `attempt ${attempt}`)
    assert.equal(result.limit, LIMIT)
  }
  const denied = decide({ comments: commentsFor(range(1, 5)) })
  assert.equal(denied.decision, 'limit-reached')
  assert.equal(denied.count, 6)
  assert.equal(denied.reason, 'limit-reached')
})

test('only markers of the current pull request count', () => {
  const other = commentsFor(range(1, 10), PR + 1)
  const result = decide({ comments: other })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 1)
})

test('markers from untrusted and missing authors are ignored', () => {
  const forged = [
    { body: marker(PR, '50.1'), author: 'mallory' },
    { body: marker(PR, '51.1'), author: 'dependabot[bot]' },
    { body: marker(PR, '52.1'), author: 'github-actions' },
    { body: marker(PR, '53.1'), author: 'opencode-agent' },
    { body: marker(PR, '54.1') },
    marker(PR, '55.1'),
    { body: `без автора\n\n${marker(PR, '56.1')}`, author: null },
  ]
  const result = decide({ comments: forged })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 1)
  assert.equal(result.markers.length, 0)
})

test('markers from the trusted workflow bot count', () => {
  for (const author of ['github-actions[bot]', 'opencode-agent[bot]']) {
    const result = decide({
      comments: [{ body: marker(PR, '60.1'), author }],
    })
    assert.equal(result.decision, 'allow', author)
    assert.equal(result.count, 2, author)
    assert.equal(result.markers.length, 1, author)
  }
})

test('forged markers cannot exhaust the run limit', () => {
  const forged = range(1, 10).map((run) => ({
    body: marker(PR, run),
    author: 'mallory',
  }))
  const result = decide({ comments: forged })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 1)

  const mixed = [...commentsFor(range(1, 4)), ...forged]
  assert.equal(decide({ comments: mixed }).count, 5)
  const denied = decide({ comments: [...commentsFor(range(1, 5)), ...forged] })
  assert.equal(denied.decision, 'limit-reached')
  assert.equal(denied.count, 6)
})

test('a run cancelled before reservation does not consume the limit', () => {
  // Four reserved runs; a fifth run was cancelled before it posted a marker,
  // and a new attempt now starts with no marker of its own.
  const result = decide({ comments: commentsFor(range(1, 4)) })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 5)
})

test('a run cancelled after reservation still consumes the limit', () => {
  const result = decide({ comments: commentsFor(range(1, 5)) })
  assert.equal(result.decision, 'limit-reached')
  assert.equal(result.count, 6)
})

test('the current attempt is counted when its own marker is present', () => {
  const runs = ['10.1', '11.1', '12.1', '13.1', '1000.1']
  const result = decide({ comments: commentsFor(runs) })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 5)
})

test('a missing current marker is counted conservatively', () => {
  const runs = ['10.1', '11.1', '12.1', '13.1', '14.1']
  const result = decide({ comments: commentsFor(runs) })
  assert.equal(result.decision, 'limit-reached')
  assert.equal(result.count, 6)
})

test('a marker of another attempt of the same run is a separate attempt', () => {
  const result = decide({
    run: '1000.2',
    comments: commentsFor(['1000.1']),
  })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 2)
})

test('markers outside the expected comment form are ignored', () => {
  const result = decide({
    comments: [
      '<!-- review-run-limit pr=26 run=old sha=short -->',
      `<!-- review-run-limit pr=999 run=1.1 sha=${SHA} -->`,
      'обычный комментарий с упоминанием review-run-limit',
    ],
  })
  assert.equal(result.decision, 'allow')
  assert.equal(result.count, 1)
  assert.equal(result.markers.length, 0)
})

test('the marker is a hidden comment carrying pull request, run and SHA', () => {
  assert.equal(
    buildMarker({ pr: PR, run: '1000.1', sha: SHA }),
    `<!-- review-run-limit pr=26 run=1000.1 sha=${SHA} -->`,
  )
  const body = buildMarker({ pr: PR, run: '1000.1', sha: SHA })
  const [parsed] = parseMarkers([{ body, author: WORKFLOW_BOT }])
  assert.deepEqual(parsed, { pr: PR, run: '1000.1', sha: SHA })
  assert.deepEqual(parseMarkers([{ body, author: 'mallory' }]), [])
  assert.deepEqual(parseMarkers([body]), [])
})

test('an allowed decision carries the reservation marker to publish', () => {
  const result = decide()
  assert.equal(result.decision, 'allow')
  assert.equal(result.marker, marker(PR, '1000.1'))
})

test('a GitHub API failure closes the gate with an error decision', () => {
  const result = decide({ apiError: 'gh api failed: 502' })
  assert.equal(result.decision, 'error')
  assert.equal(result.reason, 'github-api')
  assert.equal(result.marker, undefined)
})

test('unusable comment data closes the gate with an error decision', () => {
  for (const comments of [undefined, null, 'body', 42, { body: 'x' }]) {
    const result = decide({ comments })
    assert.equal(result.decision, 'error', String(comments))
    assert.equal(result.reason, 'comments-unavailable')
  }
})

test('invalid identifiers close the gate with an error decision', () => {
  assert.equal(decide({ pr: 0 }).reason, 'invalid-pr')
  assert.equal(decide({ pr: '26' }).reason, 'invalid-pr')
  assert.equal(decide({ run: '' }).reason, 'invalid-run')
  assert.equal(decide({ run: 'a b' }).reason, 'invalid-run')
  assert.equal(decide({ sha: '' }).reason, 'invalid-sha')
  for (const result of [
    decide({ pr: 0 }),
    decide({ run: '' }),
    decide({ sha: '' }),
  ]) {
    assert.equal(result.decision, 'error')
  }
})

test('the CLI prints the decision as JSON from a file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-limit-'))
  try {
    const input = join(directory, 'input.json')
    await writeFile(
      input,
      JSON.stringify({
        pr: PR,
        run: '1000.1',
        sha: SHA,
        comments: commentsFor(['10.1', '11.1']),
      }),
    )
    const result = spawnSync(
      process.execPath,
      ['scripts/review-run-limit.mjs', '--input', input],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    const decision = JSON.parse(result.stdout)
    assert.equal(decision.decision, 'allow')
    assert.equal(decision.count, 3)
    assert.equal(decision.marker, marker(PR, '1000.1'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the CLI reads stdin when no input file is given', () => {
  const result = spawnSync(process.execPath, ['scripts/review-run-limit.mjs'], {
    encoding: 'utf8',
    input: JSON.stringify({
      pr: PR,
      run: '1000.1',
      sha: SHA,
      comments: commentsFor(range(1, 5)),
    }),
  })
  assert.equal(result.status, 0, result.stderr)
  const decision = JSON.parse(result.stdout)
  assert.equal(decision.decision, 'limit-reached')
  assert.equal(decision.count, 6)
})

test('the CLI ignores forged markers from untrusted comment authors', () => {
  const forged = range(1, 10).map((run) => ({
    body: marker(PR, run),
    author: 'mallory',
  }))
  const result = spawnSync(process.execPath, ['scripts/review-run-limit.mjs'], {
    encoding: 'utf8',
    input: JSON.stringify({
      pr: PR,
      run: '1000.1',
      sha: SHA,
      comments: forged,
    }),
  })
  assert.equal(result.status, 0, result.stderr)
  const decision = JSON.parse(result.stdout)
  assert.equal(decision.decision, 'allow')
  assert.equal(decision.count, 1)
})

test('the CLI exits non-zero only for unusable input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-limit-'))
  try {
    const broken = join(directory, 'broken.json')
    await writeFile(broken, '{not json')
    const cases = [
      ['--input', join(directory, 'missing.json')],
      ['--input', broken],
      ['--input'],
      ['--unknown', broken],
    ]
    for (const args of cases) {
      const result = spawnSync(
        process.execPath,
        ['scripts/review-run-limit.mjs', ...args],
        { encoding: 'utf8', input: '' },
      )
      assert.notEqual(result.status, 0, args.join(' '))
      assert.equal(result.stdout.trim(), '', args.join(' '))
      assert.match(result.stderr, /\S/, args.join(' '))
    }
    const notObject = spawnSync(
      process.execPath,
      ['scripts/review-run-limit.mjs'],
      { encoding: 'utf8', input: '[]' },
    )
    assert.notEqual(notObject.status, 0)
    assert.match(notObject.stderr, /\S/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function range(start, end) {
  const values = []
  for (let value = start; value <= end; value += 1) values.push(`${value}.1`)
  return values
}
