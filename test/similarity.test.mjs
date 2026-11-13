import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchedTokens, normalizeText, scoreTexts } from '../src/similarity.mjs'

test('identical text scores 1', () => {
  assert.equal(scoreTexts('论文引用核查', '论文引用核查'), 1)
})

test('punctuation-only difference scores 1', () => {
  assert.equal(scoreTexts('论文引用核查！', '论文，引用核查。'), 1)
})

test('similar Chinese topic crosses the strong threshold', () => {
  const score = scoreTexts('论文引用核查', '论文参考文献核查')
  assert.ok(score >= 0.55, `expected >= 0.55, got ${score}`)
})

test('related but distinct scores medium', () => {
  const score = scoreTexts('检查参考文献格式', '论文引用核查')
  assert.ok(score > 0.15 && score < 0.75, `expected medium, got ${score}`)
})

test('unrelated score stays low', () => {
  const score = scoreTexts('部署生产环境', '修复登录 bug')
  assert.ok(score < 0.2, `expected < 0.2, got ${score}`)
})

test('empty input scores 0', () => {
  assert.equal(scoreTexts('', '论文'), 0)
  assert.equal(scoreTexts('论文', ''), 0)
  assert.equal(scoreTexts('   ', '论文'), 0)
})

test('long text is not penalized for length alone', () => {
  const score = scoreTexts('论文引用核查', '论文引用核查：请核对所有引用与参考文献的年份、页码与作者')
  assert.ok(score >= 0.6, `expected >= 0.6, got ${score}`)
})

test('normalize folds width, case and punctuation', () => {
  assert.equal(normalizeText('  ＢＵＧ　修复:登录!! '), 'bug 修复 登录')
})

test('matchedTokens reports overlapping tokens', () => {
  const matched = matchedTokens('论文引用核查', '论文参考文献核查')
  assert.ok(matched.includes('论'))
  assert.ok(matched.includes('核'))
})
