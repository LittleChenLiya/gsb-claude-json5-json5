/**
 * Thrown when snapshot traversal reaches a getter whose real path is not
 * declared in `allow`. The throw happens before the getter is read, and no
 * output is produced.
 */
export class SnapshotAccessError extends Error {
    /**
     * The real path (array of string keys/indices) of the rejected getter,
     * relative to the snapshot root.
     */
    path: string[]
}

/**
 * A getter path is an array of object keys/array indices relative to the
 * snapshot root. Numbers name array indices and are treated the same as their
 * string form, so [0] and ['0'] are the same path.
 */
export type GetterPath = Array<string | number>

export interface SnapshotOptions {
    /**
     * The real paths whose getters may execute. A single path may be passed
     * directly, or an array of paths. Every getter reached by the traversal
     * whose path is not declared here is rejected before it is read.
     */
    allow?: GetterPath | GetterPath[]

    /**
     * Same as the JSON5.stringify `replacer` parameter. The replacer only sees
     * the pure-data snapshot and never receives the original object, so it
     * cannot re-trigger a getter.
     */
    replacer?: ((this: any, key: string, value: any) => any) | (string | number)[] | null

    /**
     * Same as the JSON5.stringify `space` parameter.
     */
    space?: string | number | null

    /**
     * Same as the JSON5.stringify `quote` option.
     */
    quote?: string | null
}

/**
 * Produces a pure-data snapshot of value. Plain data properties are copied;
 * getters are executed at most once and only when their real path is declared
 * in `options.allow`. toJSON/toJSON5 and all other object methods are never
 * invoked.
 *
 * @param value The value to snapshot.
 * @param options Snapshot options (at minimum, the declared `allow` paths).
 * @returns A plain object/array/primitive snapshot with no accessor properties.
 * @throws {SnapshotAccessError} if a non-declared getter is reached.
 */
export function snapshot(value: any, options?: SnapshotOptions): any

/**
 * Snapshots value first and then serializes the snapshot with JSON5.stringify.
 * On any failure (including a rejected getter) the function throws and no
 * output is produced. The default JSON5.stringify is unchanged.
 *
 * @param value The value to convert to a JSON5 string through a snapshot.
 * @param options Snapshot and stringify options.
 * @returns The JSON5 string converted from the pure-data snapshot.
 */
export function snapshotStringify(value: any, options?: SnapshotOptions): string
