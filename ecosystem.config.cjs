module.exports = {
  apps: [
    {
      name: "tgmax-sync-worker",
      cwd: "/root/tgmax-sync",
      script: "npm",
      args: "run sync:worker",
      interpreter: "none",
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
