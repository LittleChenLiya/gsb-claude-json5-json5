declare type SnapshotOptions = {
    /**
     * The paths whose getters are allowed to execute. Paths may be strings
     * (`'a.b[0]'`) or arrays (`['a', 'b', 0]`). Only getters at these paths
     * are executed; all other getters are rejected before they are read.
     */
    paths?: (string | (string | number)[])[]
}

/**
 * Creates an explicit, plain-data snapshot of a JavaScript value.
 *
 * Only getters whose path is declared in `options.paths` are executed.
 * All other getters are rejected (a TypeError is thrown) before they are
 * read. Allowed getters run at most once. The returned value is a pure
 * data structure (plain objects, arrays, and primitives) with no active
 * getters, so it can be safely passed to `JSON5.stringify` without
 * triggering the original object's getters again.
 *
 * No object methods (including `toJSON`/`toJSON5`) are invoked.
 *
 * @param value The value to snapshot.
 * @param options An object specifying the allowed getter paths.
 * @returns A plain-data snapshot of the value.
 */
declare function snapshot(value: any, options?: SnapshotOptions): any

export = snapshot
