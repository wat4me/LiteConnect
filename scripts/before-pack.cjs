module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return
  if (process.platform !== 'win32') throw new Error('Build the Windows X11 runtime on a Windows host.')
  const { prepareX11Runtime } = await import('./prepare-x11-runtime.mjs')
  prepareX11Runtime({ verifyAll: true })
}
