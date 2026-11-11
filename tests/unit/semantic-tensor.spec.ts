/**
 * The pure tensor math behind local embeddings: masked mean/cls/last-token
 * pooling, L2 normalization, and cosine similarity, driven with synthetic
 * buffers so the math is checked without any model.
 * @module tests/unit/semantic-tensor
 */

import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  l2NormalizeInPlace,
  poolTokenEmbeddings,
} from '../../src/enrichment/semantic/tensor.ts'

/** A [2, 3] hidden state: row 0 = [1, 2, 3], row 1 = [4, 5, 6]. */
function hidden2x3(): Float32Array {
  return new Float32Array([1, 2, 3, 4, 5, 6])
}

describe('poolTokenEmbeddings', () => {
  it('pools cls as position 0 regardless of the mask', () => {
    const pooled = poolTokenEmbeddings('cls', hidden2x3(), 3, 2, [1, 0])
    expect([...pooled]).toEqual([1, 2, 3])
  })

  it('pools last_token at the last attended position', () => {
    const pooled = poolTokenEmbeddings('last_token', hidden2x3(), 3, 2, [1, 1])
    expect([...pooled]).toEqual([4, 5, 6])
    // Padding tail is skipped: the last attended row wins.
    expect([...poolTokenEmbeddings('last_token', hidden2x3(), 3, 2, [1, 0])]).toEqual([1, 2, 3])
  })

  it('means only the attended rows', () => {
    const pooled = poolTokenEmbeddings('mean', hidden2x3(), 3, 2, [1, 1])
    expect([...pooled]).toEqual([2.5, 3.5, 4.5])
    // A padded second row must not dilute the mean.
    const masked = poolTokenEmbeddings('mean', hidden2x3(), 3, 2, [1, 0])
    expect([...masked]).toEqual([1, 2, 3])
  })

  it('returns zeros when nothing is attended', () => {
    const pooled = poolTokenEmbeddings('mean', hidden2x3(), 3, 2, [0, 0])
    expect([...pooled]).toEqual([0, 0, 0])
  })
})

describe('l2NormalizeInPlace', () => {
  it('scales to unit length and leaves a zero vector alone', () => {
    const vector = new Float32Array([3, 4])
    l2NormalizeInPlace(vector)
    expect(vector[0]).toBeCloseTo(0.6, 6)
    expect(vector[1]).toBeCloseTo(0.8, 6)
    const zero = new Float32Array([0, 0])
    l2NormalizeInPlace(zero)
    expect([...zero]).toEqual([0, 0])
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical directions and 0 for orthogonal ones', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([2, 0]))).toBeCloseTo(1, 12)
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 3]))).toBe(0)
  })

  it('is 0 when either side is a zero vector, not NaN', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0)
  })

  it('refuses unequal widths instead of truncating to the shorter vector', () => {
    expect(() => cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0]))).toThrow(
      /dimension mismatch/,
    )
  })

  it('refuses non-finite components instead of returning a plausible cosine', () => {
    expect(() =>
      cosineSimilarity(new Float32Array([Number.NaN, 0]), new Float32Array([1, 0])),
    ).toThrow(/non-finite/)
  })
})
