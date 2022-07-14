import * as z from 'zod'
import {
  EnvironmentError,
  InputError,
  InputErrors,
  schemaError,
  toErrorWithMessage,
} from './errors'
import {
  DomainFunction,
  ErrorData,
  Result,
  SchemaError,
  SuccessResult,
} from './types'

type MakeDomainFunction = <
  Schema extends z.ZodTypeAny,
  EnvSchema extends z.ZodTypeAny,
>(
  inputSchema: Schema,
  environmentSchema?: EnvSchema,
) => <Output>(
  handler: (
    inputSchema: z.infer<Schema>,
    environmentSchema: z.infer<EnvSchema>,
  ) => Promise<Output>,
) => DomainFunction<Output>

const formatSchemaErrors = (errors: z.ZodIssue[]): SchemaError[] =>
  errors.map((error) => {
    const { path, message } = error
    return { path: path.map(String), message }
  })

const makeDomainFunction: MakeDomainFunction =
  (
    inputSchema: z.ZodTypeAny = z.object({}),
    environmentSchema: z.ZodTypeAny = z.object({}),
  ) =>
  (handler) => {
    const domainFunction = (async (input, environment = {}) => {
      const envResult = await environmentSchema.safeParseAsync(environment)
      const result = await inputSchema.safeParseAsync(input)

      try {
        if (result.success === true && envResult.success === true) {
          return {
            success: true,
            data: await handler(result.data, envResult.data),
            errors: [],
            inputErrors: [],
            environmentErrors: [],
          }
        }
      } catch (error) {
        if (error instanceof InputError) {
          return {
            success: false,
            errors: [],
            environmentErrors: [],
            inputErrors: [schemaError(error.message, error.path)],
          }
        }
        if (error instanceof EnvironmentError) {
          return {
            success: false,
            errors: [],
            environmentErrors: [schemaError(error.message, error.path)],
            inputErrors: [],
          }
        }
        if (error instanceof InputErrors) {
          return {
            success: false,
            errors: [],
            environmentErrors: [],
            inputErrors: error.errors.map((e) =>
              schemaError(e.message, e.path),
            ),
          }
        }
        return {
          success: false,
          errors: [toErrorWithMessage(error)],
          inputErrors: [],
          environmentErrors: [],
        }
      }
      return {
        success: false,
        errors: [],
        inputErrors: result.success
          ? []
          : formatSchemaErrors(result.error.issues),
        environmentErrors: envResult.success
          ? []
          : formatSchemaErrors(envResult.error.issues),
      }
    }) as DomainFunction<Awaited<ReturnType<typeof handler>>>
    return domainFunction
  }

type Unpack<T> = T extends DomainFunction<infer F> ? F : T
function all<T extends readonly unknown[] | []>(
  ...fns: T
): DomainFunction<{ -readonly [P in keyof T]: Unpack<T[P]> }> {
  return async (input, environment) => {
    const results = await Promise.all(
      fns.map((fn) => (fn as DomainFunction)(input, environment)),
    )

    if (!isListOfSuccess(results)) {
      return {
        success: false,
        errors: results.map(({ errors }) => errors).flat(),
        inputErrors: results.map(({ inputErrors }) => inputErrors).flat(),
        environmentErrors: results
          .map(({ environmentErrors }) => environmentErrors)
          .flat(),
      }
    }

    return {
      success: true,
      data: results.map(({ data }) => data),
      inputErrors: [],
      environmentErrors: [],
      errors: [],
    } as unknown as SuccessResult<{ -readonly [P in keyof T]: Unpack<T[P]> }>
  }
}

function isListOfSuccess<T>(result: Result<T>[]): result is SuccessResult<T>[] {
  return result.every(({ success }) => success === true)
}

type Last<T extends readonly unknown[]> = T extends [...infer I, infer L]
  ? L
  : never
type Pipe = <T extends readonly DomainFunction[]>(...fns: T) => Last<T>
const pipe: Pipe = (...fns) => {
  const [head, ...tail] = fns

  return ((input: unknown, environment?: unknown) => {
    return tail.reduce(async (memo, fn) => {
      const resolved = await memo
      if (resolved.success) {
        return fn(resolved.data as unknown, environment)
      } else {
        return memo
      }
    }, head(input, environment))
  }) as Last<typeof fns>
}

function sequence<T extends readonly unknown[] | []>(
  ...fns: T
): DomainFunction<{ -readonly [P in keyof T]: Unpack<T[P]> }> {
  return async function (input: unknown, environment?: unknown) {
    const results = []
    let currResult: undefined | Result<unknown>
    for await (const fn of fns as DomainFunction[]) {
      const result = await fn(
        currResult?.success ? currResult.data : input,
        environment,
      )
      if (!result.success) return result
      currResult = result
      results.push(result.data)
    }

    return {
      success: true,
      data: results,
      inputErrors: [],
      environmentErrors: [],
      errors: [],
    } as unknown as SuccessResult<{ -readonly [P in keyof T]: Unpack<T[P]> }>
  }
}

type Map = <O, R>(
  dfn: DomainFunction<O>,
  mapper: (element: O) => R,
) => DomainFunction<R>

const map: Map = (dfn, mapper) => {
  return async (input, environment) => {
    const result = await dfn(input, environment)
    if (!result.success) return result

    try {
      return {
        success: true,
        data: mapper(result.data),
        errors: [],
        inputErrors: [],
        environmentErrors: [],
      }
    } catch (error) {
      const errors = [toErrorWithMessage(error)]
      return {
        success: false,
        errors,
        inputErrors: [],
        environmentErrors: [],
      }
    }
  }
}
type MapError = <O>(
  dfn: DomainFunction<O>,
  mapper: (element: ErrorData) => ErrorData,
) => DomainFunction<O>

const mapError: MapError = (dfn, mapper) => {
  return async (input, environment) => {
    const result = await dfn(input, environment)
    if (result.success) return result

    try {
      return { ...mapper(result), success: false }
    } catch (error) {
      const errors = [toErrorWithMessage(error)]
      return {
        success: false,
        errors,
        inputErrors: [],
        environmentErrors: [],
      }
    }
  }
}

export { makeDomainFunction, all, pipe, sequence, map, mapError }
