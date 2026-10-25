export function isCaptureProtocolError(error: unknown) {
  return error instanceof Error && error.message.includes('Protocol error (Page.captureScreenshot): Unable to capture screenshot')
}

// Retry only this Chromium capture error, once. Stabilization/assertion errors,
// timeouts, browser closure and a second capture failure must still fail the test.
export async function captureWithRetry<T>(capture: () => Promise<T>, stabilize: () => Promise<void>, onRetry: (error: Error) => Promise<void>) {
  await stabilize()
  try { return await capture() } catch (error) {
    if (!isCaptureProtocolError(error)) throw error
    await onRetry(error as Error)
    await stabilize()
    return capture()
  }
}
