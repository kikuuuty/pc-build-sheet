import { describe, expect, it, vi } from 'vitest'
import { captureWithRetry } from '../../e2e/screenshot-retry'

describe('bounded diagnostic screenshot recovery', () => {
  const captureError = new Error('page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot')
  it('retries only the specific protocol error once, recording the first failure', async () => {
    const capture = vi.fn().mockRejectedValueOnce(captureError).mockResolvedValueOnce('png')
    const stabilize = vi.fn().mockResolvedValue(undefined)
    const report = vi.fn().mockResolvedValue(undefined)
    expect(await captureWithRetry(capture, stabilize, report)).toBe('png')
    expect(capture).toHaveBeenCalledTimes(2)
    expect(stabilize).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledWith(captureError)
  })
  it('does not swallow a second capture failure', async () => {
    const capture = vi.fn().mockRejectedValue(captureError)
    await expect(captureWithRetry(capture, async () => {}, async () => {})).rejects.toBe(captureError)
    expect(capture).toHaveBeenCalledTimes(2)
  })
  it.each(['Timeout 30000ms exceeded', 'browser has been closed', 'Expected width >= 100'])('does not retry %s', async (message) => {
    const error = new Error(message)
    const capture = vi.fn().mockRejectedValue(error)
    const report = vi.fn()
    await expect(captureWithRetry(capture, async () => {}, report)).rejects.toBe(error)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })
  it('never catches a layout assertion failure as a screenshot error', async () => {
    const capture = vi.fn()
    const failure = new Error('layout changed')
    await expect(captureWithRetry(capture, async () => { throw failure }, async () => {})).rejects.toBe(failure)
    expect(capture).not.toHaveBeenCalled()
  })
})
