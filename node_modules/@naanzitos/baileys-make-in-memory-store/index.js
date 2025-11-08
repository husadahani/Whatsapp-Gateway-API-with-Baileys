// Baileys makeInMemoryStore Fix
// This package restores the makeInMemoryStore functionality in Baileys

console.log('📦 baileys-make-in-memory-store loaded')
console.log('💡 Files have been automatically injected via postinstall')
console.log('🚀 Use: const { makeInMemoryStore } = require("@whiskeysockets/baileys")')

module.exports = {
  name: 'baileys-make-in-memory-store',
  version: require('./package.json').version,
  description: 'Restore makeInMemoryStore functionality for Baileys',
  author: require('./package.json').author,
  repository: require('./package.json').repository
}
