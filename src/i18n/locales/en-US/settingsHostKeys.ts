export default {
  settingsHostKeys: {
    title: 'Host trust',
    intro: 'Manage the server fingerprints confirmed and saved the first time you connect to an SSH host.',
    trusted: 'Trusted hosts',
    hint: 'Fingerprints confirm that you are connecting to the same server. Remove one only after a reinstall, a key change, or a mistaken record.',
    empty: 'No trusted hosts yet',
    firstSeen: 'First trusted: {time}',
    removeTitle: 'Remove host trust?',
    removeMessage: 'This removes the trusted fingerprint for {host}:{port}. The next connection will ask you to confirm the server identity again.',
    removed: 'Removed the trust record for this host',
    loadFailed: 'Could not read host trust records',
    removeFailed: 'Could not remove the record',
  },
}
