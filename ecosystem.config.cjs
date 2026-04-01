module.exports = {
  apps: [
    {
      name: "tgmax-sync-web",
      cwd: "/root/tgmax-sync",
      script: "npm",
      args: "run web",
      interpreter: "none",
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
