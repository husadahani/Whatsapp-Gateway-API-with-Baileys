module.exports = {
  apps: [{
    name: 'whatsapp-gateway',
    script: './server.mjs',
    instances: 1,
    exec_mode: 'fork', // Changed from cluster to fork to avoid issues with Baileys
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      API_KEY: 'whatsapp_gateway_default_key',
      JWT_SECRET: 'whatsapp_jwt_secret'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};