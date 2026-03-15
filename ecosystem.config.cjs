module.exports = {
  apps: [
    {
      name: "downey-evals-loop",
      script: "scripts/serve-dist.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3000",
      },
    },
  ],
};
