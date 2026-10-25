/**
 * @fileoverview Schemas are named shapes. They give a spider its item type,
 * describe the database columns Loom creates, and compose like values:
 *
 *   const product = schema({name: 'h1', price: $('.price').number()});
 *   const productWithStock = product.extend({stock: $('.stock').int()});
 */

import type {ValueKind} from './field.js';
import {compileShape, type CompiledShape} from './selector.js';
import {
  SCHEMA_BRAND,
  type InferShape,
  type SchemaLike,
  type Shape,
} from './types.js';

/** A column derived from a schema field. */
export interface ColumnDescriptor {
  /** The item key (camelCase); storage maps it to a snake_case column. */
  readonly name: string;
  readonly kind: ValueKind;
  readonly nullable: boolean;
}

/** A reusable, composable extraction shape. */
export class Schema<S extends Shape> implements SchemaLike<S> {
  readonly [SCHEMA_BRAND] = true as const;
  /** Type-level marker carrying the item type. Never set at runtime. */
  declare readonly item: InferShape<S>;

  constructor(readonly shape: S) {}

  /** The compiled fields of this schema. */
  get fields(): CompiledShape {
    return compileShape(this.shape);
  }

  /** Returns a new schema with additional (or overridden) keys. */
  extend<E extends Shape>(extra: E): Schema<Omit<S, keyof E> & E> {
    return new Schema({...this.shape, ...extra} as Omit<S, keyof E> & E);
  }

  /** Returns a new schema containing only `keys`. */
  pick<K extends keyof S & string>(...keys: K[]): Schema<Pick<S, K>> {
    const picked: Partial<Record<K, S[K]>> = {};
    for (const key of keys) picked[key] = this.shape[key];
    return new Schema(picked as Pick<S, K>);
  }

  /** Returns a new schema without `keys`. */
  omit<K extends keyof S & string>(...keys: K[]): Schema<Omit<S, K>> {
    const rest: Record<string, unknown> = {...this.shape};
    for (const key of keys) delete rest[key];
    return new Schema(rest as Omit<S, K>);
  }

  /** Column descriptors used for automatic table creation. */
  columns(): ColumnDescriptor[] {
    return columnsOf(this.shape);
  }
}

/** Creates a schema from a shape. */
export function schema<S extends Shape>(shape: S): Schema<S> {
  return new Schema(shape);
}

/** Derives column descriptors from any shape or schema. */
export function columnsOf(input: Shape | SchemaLike): ColumnDescriptor[] {
  return Object.entries(compileShape(input)).map(([name, field]) => ({
    name,
    kind: field.kind,
    nullable: field.nullable,
  }));
}
