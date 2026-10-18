import { z } from "zod";

export interface JsonSchemaShape {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  description?: string;
}

export function jsonSchemaToZod(schema: Record<string, unknown>, isRequired: boolean): z.ZodTypeAny {
  const description = typeof schema.description === "string" ? schema.description : undefined;
  const type = schema.type as string | undefined;

  let zodType: z.ZodTypeAny;
  switch (type) {
    case "number":
    case "integer":
      zodType = type === "integer" ? z.number().int() : z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      zodType = z.array(items ? jsonSchemaToZod(items, true) : z.unknown());
      break;
    }
    case "object":
      zodType = z.record(z.string(), z.unknown());
      break;
    default:
      zodType = z.string();
  }

  const withDescription = description ? zodType.describe(description) : zodType;
  return isRequired ? withDescription : withDescription.optional();
}

export function jsonSchemaToZodObject(schema: JsonSchemaShape): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      shape[key] = jsonSchemaToZod(value as Record<string, unknown>, required.has(key));
    }
  }
  const objectSchema = z.object(shape);
  return schema.type === "object" ? (objectSchema.passthrough() as z.ZodObject<Record<string, z.ZodTypeAny>>) : objectSchema;
}
