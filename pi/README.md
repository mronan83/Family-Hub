# The board kit for a Raspberry Pi

Turns a fresh Raspberry Pi OS Lite (64-bit) on a Raspberry Pi 4 or 5 into a FamilyWise board (WP-14, D-83). On the Pi, over SSH:

```
curl -fsSL https://raw.githubusercontent.com/mronan83/Family-Hub/main/pi/install.sh | sudo bash
```

Step by step, for the family: `docs/07-user-guide.md`, A16. How it works: `docs/01-technical-architecture.md`, §8.

| File        | What it is                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| `install.sh` | Downloads this folder from GitHub and runs `setup.sh`                        |
| `setup.sh`  | Installs and configures the Pi; safe to run again                             |
| `fw-kiosk`  | Keeps Chromium open on the board, full screen                                 |
| `fw-screen` | The screen off and on                                                         |
| `fw-check`  | The board's health and speed report (with `check.py`)                         |
| `test.sh`   | The kit's checks, run in CI                                                   |
