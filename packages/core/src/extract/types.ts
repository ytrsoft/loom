/**
 * @fileoverview Types describing extraction shapes and the TypeScript types
 * inferred from them. A shape is a plain object whose values are fields,
 * shorthand strings or nested shapes:
 *
 *   {
 *     title: 'h1',                     // text of <h1>
 *     link: 'a.more @href',            // absolute URL from an attribute
 *     price: $('.price').number(),     // typed field
 *     seller: {name: '.seller', url: '.seller @href'},  // nested object
 *   }
 */

import type {Field} from './field.js';

/** A value allowed inside a shape. */
export type ShapeValue = Field<unknown, boolean> | string | Shape;

/** An extraction shape: keys map to fields, shorthands or nested shapes. */
export interface Shape {
  readonly [key: string]: ShapeValue;
}

/** Brand that identifies {@link SchemaLike} values at runtime. */
export const SCHEMA_BRAND: unique symbol = Symbol.for('loom.schema');

/** A named, reusable shape created with `schema()`. */
export interface SchemaLike<S extends Shape = Shape> {
  readonly [SCHEMA_BRAND]: true;
  readonly shape: S;
}

/** Anything that can be passed to `extract()`. */
export type Extractable = Field<unknown, boolean> | SchemaLike | Shape | string;

/** Flattens intersections for readable editor tooltips. */
export type Simplify<T> = {[K in keyof T]: T[K]};

/** The object type produced by a shape. */
export type InferShape<S extends Shape> = Simplify<{
  -readonly [K in keyof S]: Infer<S[K]>;
}>;

/** The TypeScript type produced by extracting `T`. */
export type Infer<T> =
  T extends Field<infer V, infer M>
    ? M extends true
      ? V[]
      : V
    : T extends SchemaLike<infer S>
      ? InferShape<S>
      : T extends string
        ? string
        : T extends Shape
          ? InferShape<T>
          : never;

/** Runtime check for schema values. */
export function isSchema(value: unknown): value is SchemaLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<SchemaLike>)[SCHEMA_BRAND] === true
  );
}
