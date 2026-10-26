export default {
  dialog: {
    hostKeyTitle: 'Confirm host key',
    kbTitle: 'Two-factor authentication required',
    kbTitleJump: 'Jump host requires two-factor authentication',
    kbHint: 'The server requires interactive authentication (password or one-time code).',
    kbPromptFallback: 'Prompt {n}',
    hostKeyTitleFirst: 'First connection: confirm the host identity',
    hostKeyTitleFirstJump: 'First jump-host connection: confirm the host identity',
    hostKeyTitleMismatch: 'Host key has changed (review carefully)',
    hostKeyTitleMismatchJump: 'Jump host key has changed (review carefully)',
    hostKeyWarning: 'The SSH host key for {host}:{port} does not match the local record.',
    hostKeyWarningJump: 'The SSH host key for jump host {host}:{port} does not match the local record.',
    hostKeyWarningUnknown:
      'This is the first connection to {host}:{port}. The app will store the fingerprint below locally and use it to recognize the same machine later.',
    hostKeyWarningUnknownJump:
      'This is the first connection to jump host {host}:{port}. Verify the fingerprint before trusting it; a spoofed jump host is a higher risk.',
    hostKeyNote: 'This can mean the server was reinstalled, or it can mean a man-in-the-middle attack. Check the fingerprint below before deciding whether to trust it.',
    hostKeyNoteFirst:
      'If you trust this host (for example, you just received the address from operations), choose Trust and connect. If you are unsure, ask an administrator to confirm the SHA256 fingerprint below.',
    hostKeyNoteMismatch:
      'Key changes are common after a reinstall, a hardware replacement, or a key rotation. They can also mean the connection was intercepted. Compare the new fingerprint with the value from your administrator before continuing.',
    hostKeyStep1: 'Compare the large SHA256 fingerprint below (use Copy to send it to a colleague)',
    hostKeyStep2: 'If it matches, choose Trust and connect; the app will remember this host',
    hostKeyStep3: 'If you are unsure, choose Reject connection and ask an administrator later',
    fingerprintOld: 'Local record (old)',
    fingerprintNew: 'This connection (new)',
    fingerprintCurrent: 'Host key fingerprint',
    fingerprintHint: 'The fingerprint algorithm is SHA256. Grouping is only for easier comparison; Copy uses the full single line.',
    copyFingerprint: 'Copy fingerprint',
    rejectConnect: 'Reject connection',
    trustAndConnect: 'Trust and connect',
    trustChangedKey: 'Trust the new key and connect',
    decryptFailedTitle: 'Could not decrypt the secret',
    decryptFailedNote:
      'This usually happens after an account change, an OS reinstall, or a data migration. Edit the connection, enter the {field} again, and save to restore the connection.',
    password: 'password',
    privateKey: 'private key',
    resetPassword: 'Reset password',
    requiredEmpty: 'This field cannot be empty',
    invalidInput: 'Invalid input',
  },
}
