# Running Coda in the Background

On a Linux host, Coda can run as a background service for your user. It starts when the machine
boots and keeps running after you log out.

## Manage the Service

Install it with the latest Coda release:

```sh
npx coda@latest service install
```

Check whether it is installed:

```sh
npx coda@latest service status
```

Update or repair it:

```sh
npx coda@latest service update
```

Stop it and remove it from startup:

```sh
npx coda@latest service uninstall
```

Updating restarts Coda briefly. Let active agent work and terminal commands finish first.

The systemd unit runs a small stable launcher. Exact T3 Code versions are installed separately, so
a failed remote candidate can return to the previous version without rewriting the unit. Releases
that change the database must be installed with the local `service update` command above.

## Using It with T3 Connect

T3 Connect may offer to install the service during setup so the host stays reachable after you log
out. This is only an onboarding shortcut: the service and T3 Connect are managed separately.

Signing out of T3 Connect does not remove the service. Use `t3 service uninstall` when you no longer
want Coda to start in the background.

The background service currently requires Linux with systemd.
