import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { writeAntigravityClientTextFile } from "./AntigravityClientFiles.ts";

it.layer(NodeServices.layer)("AntigravityClientFiles", (it) => {
  it.effect("writes a new file in a missing directory under a symlinked root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "coda-agy-files-" });
      const workspace = path.join(base, "workspace");
      const link = path.join(base, "link");
      yield* fileSystem.makeDirectory(workspace);
      yield* fileSystem.symlink(workspace, link);

      yield* writeAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [link],
        request: {
          sessionId: "session",
          path: path.join(link, "nested", "new.txt"),
          content: "created",
        },
      });

      assert.equal(
        yield* fileSystem.readFileString(path.join(workspace, "nested", "new.txt")),
        "created",
      );
    }),
  );

  it.effect("rejects a new file in a missing directory outside the roots", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "coda-agy-files-" });
      const workspace = path.join(base, "workspace");
      const escape = path.join(base, "outside", "nested", "escape.txt");
      yield* fileSystem.makeDirectory(workspace);

      const written = yield* writeAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [workspace],
        request: { sessionId: "session", path: escape, content: "nope" },
      }).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(written));
      assert.isFalse(yield* fileSystem.exists(escape));
    }),
  );
});
