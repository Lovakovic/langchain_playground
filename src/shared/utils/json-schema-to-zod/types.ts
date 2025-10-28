import type { ZodTypeAny } from 'zod';

export type JSONSchemaDraft7Property =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number'; description?: string; enum?: string[] }
  | { type: 'boolean'; description?: string; enum?: string[] }
  | { type: 'null'; description?: string; enum?: string[] }
  | {
      type: 'object';
      description?: string;
      enum?: string[];
      properties: Record<string, JSONSchemaDraft7Property>;
      required?: string[];
    }
  | { type: 'array'; description?: string; enum?: string[]; items: JSONSchemaDraft7Property };

export interface JSONSchemaDraft7 {
  type: 'object';
  properties: Record<string, JSONSchemaDraft7Property>;
  required?: string[];
}

export type ZodSchemaProps = Record<string, ZodTypeAny>;

// ZodPropType is simply an alias for ZodTypeAny since Zod v4+ handles all types uniformly
export type ZodPropType = ZodTypeAny;
