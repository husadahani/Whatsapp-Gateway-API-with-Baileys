# @naanzitos/baileys-make-in-memory-store

[![npm version](https://badge.fury.io/js/@naanzitos%2Fbaileys-make-in-memory-store.svg)](https://badge.fury.io/js/@naanzitos/baileys-make-in-memory-store)

## 🚀 Installation

```bash
npm install @naanzitos/baileys-make-in-memory-store
```

Or with yarn:

```bash
yarn add @naanzitos/baileys-make-in-memory-store
```

## 📖 Usage

After installation, you can use `makeInMemoryStore` normally:

```javascript
const { makeInMemoryStore } = require('@whiskeysockets/baileys')

// Create the store
const store = makeInMemoryStore({
  logger: console
})

// Use with Baileys socket
const sock = makeWASocket({
  // ... other configurations
})

// Bind store to socket
store.bind(sock.ev)
```

## ✅ Compatibility

- ✅ Baileys v6.x
- ✅ Node.js 16+
- ✅ TypeScript (with basic types)
- ✅ ESM and CommonJS

## 🐛 Troubleshooting

If you encounter issues, try:

1. **Reinstall the package:**
   ```bash
   npm uninstall @naanzitos/baileys-make-in-memory-store && npm install @naanzitos/baileys-make-in-memory-store
   ```

2. **Clear npm cache:**
   ```bash
   npm cache clean --force
   ```

3. **Verify Baileys installation:**
   ```bash
   npm list @whiskeysockets/baileys
   ```

4. **Manual verification:**
   Check if files exist in `node_modules/@whiskeysockets/baileys/lib/Store/`

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⭐ Support

If this package helped you, please give it a star on GitHub!

## 🔗 Links

- [GitHub Repository](https://github.com/naanzitos/baileys-make-in-memory-store)
- [npm Package](https://www.npmjs.com/package/baileys-make-in-memory-store)
- [Issues](https://github.com/naanzitos/baileys-make-in-memory-store/issues)
- [Baileys Official Repository](https://github.com/WhiskeySockets/Baileys)
