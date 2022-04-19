import { describe, it, expect } from 'vitest'
import * as z from 'zod'

import {
  mapError,
  map,
  pipe,
  all,
  makeDomainFunction,
} from './domain-functions'
import { EnvironmentError, InputError, InputErrors } from './errors'
import { ErrorData, SuccessResult } from './types'

describe('makeDomainFunction', () => {
  describe('when it has no environment', () => {
    it('uses zod parser to create parse the input and call the domain function', async () => {
      const parser = z.object({ id: z.preprocess(Number, z.number()) })

      const handler = makeDomainFunction(parser)(async ({ id }) => id)

      expect(await handler({ id: '1' })).toEqual({
        success: true,
        data: 1,
        errors: [],
        inputErrors: [],
        environmentErrors: [],
      })
    })

    it('returns error when parsing fails', async () => {
      const parser = z.object({ id: z.preprocess(Number, z.number()) })
      const handler = makeDomainFunction(parser)(async ({ id }) => id)

      expect(await handler({ missingId: '1' })).toEqual({
        success: false,
        inputErrors: [
          { message: 'Expected number, received nan', path: ['id'] },
        ],
        environmentErrors: [],
        errors: [],
      })
    })
  })

  it('uses zod parsers to parse the input and environment and call the domain function', async () => {
    const parser = z.object({ id: z.preprocess(Number, z.number()) })
    const envParser = z.object({ uid: z.preprocess(Number, z.number()) })

    const handler = makeDomainFunction(
      parser,
      envParser,
    )(async ({ id }, { uid }) => [id, uid])

    expect(await handler({ id: '1' }, { uid: 2 })).toEqual({
      success: true,
      data: [1, 2],
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('applies async validations', async () => {
    const parser = z.object({
      id: z
        .preprocess(Number, z.number())
        .refine(async (value) => value !== 1, { message: 'ID already taken' }),
    })

    const envParser = z.object({
      uid: z
        .preprocess(Number, z.number())
        .refine(async (value) => value !== 2, { message: 'UID already taken' }),
    })

    const handler = makeDomainFunction(
      parser,
      envParser,
    )(async ({ id }, { uid }) => [id, uid])

    expect(await handler({ id: '1' }, { uid: '2' })).toEqual({
      success: false,
      errors: [],
      inputErrors: [{ message: 'ID already taken', path: ['id'] }],
      environmentErrors: [{ message: 'UID already taken', path: ['uid'] }],
    })
  })

  it('accepts literals as input of domain functions', async () => {
    const foo = makeDomainFunction(z.number(), z.string())(async (n) => n + 1)
    const result = await foo(1, 'not going to be used')
    expect((result as SuccessResult<number>).data).toEqual(2)
  })

  it('returns error when environment parsing fails', async () => {
    const parser = z.object({ id: z.preprocess(Number, z.number()) })
    const envParser = z.object({ uid: z.preprocess(Number, z.number()) })

    const handler = makeDomainFunction(
      parser,
      envParser,
    )(async ({ id }, { uid }) => [id, uid])

    expect(await handler({ id: '1' }, {})).toEqual({
      success: false,
      inputErrors: [],
      environmentErrors: [
        { message: 'Expected number, received nan', path: ['uid'] },
      ],
      errors: [],
    })
  })

  it('returns error when the domain function throws an Error', async () => {
    const domainFunction = makeDomainFunction(z.object({ id: z.number() }))(
      async () => {
        throw new Error('Error')
      },
    )

    expect(await domainFunction({ id: 1 })).toEqual({
      success: false,
      errors: [{ message: 'Error' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('returns error when the domain function throws a string', async () => {
    const domainFunction = makeDomainFunction(z.object({ id: z.number() }))(
      async () => {
        throw 'Error'
      },
    )

    expect(await domainFunction({ id: 1 })).toEqual({
      success: false,
      errors: [{ message: 'Error' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('returns error when the domain function throws an object with message', async () => {
    const domainFunction = makeDomainFunction(z.object({ id: z.number() }))(
      async () => {
        throw { message: 'Error' }
      },
    )

    expect(await domainFunction({ id: 1 })).toEqual({
      success: false,
      errors: [{ message: 'Error' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('returns inputErrors when the domain function throws an InputError', async () => {
    const domainFunction = makeDomainFunction(z.object({ id: z.number() }))(
      async () => {
        throw new InputError('Custom input error', 'contact.id')
      },
    )

    expect(await domainFunction({ id: 1 })).toEqual({
      success: false,
      errors: [],
      inputErrors: [{ message: 'Custom input error', path: ['contact', 'id'] }],
      environmentErrors: [],
    })
  })

  it('returns multiple inputErrors when the domain function throws an InputErrors', async () => {
    const domainFunction = makeDomainFunction(z.object({ id: z.number() }))(
      async () => {
        throw new InputErrors([
          { message: 'Custom input error', path: 'contact.id' },
          { message: 'Another input error', path: 'contact.id' },
        ])
      },
    )

    expect(await domainFunction({ id: 1 })).toEqual({
      success: false,
      errors: [],
      inputErrors: [
        { message: 'Custom input error', path: ['contact', 'id'] },
        { message: 'Another input error', path: ['contact', 'id'] },
      ],
      environmentErrors: [],
    })
  })

  it('returns environmentErrors when the domain function throws an EnvironmentError', async () => {
    const domainFunction = makeDomainFunction(z.object({ id: z.number() }))(
      async () => {
        throw new EnvironmentError('Custom env error', 'currentUser.role')
      },
    )

    expect(await domainFunction({ id: 1 })).toEqual({
      success: false,
      errors: [],
      inputErrors: [],
      environmentErrors: [
        { message: 'Custom env error', path: ['currentUser', 'role'] },
      ],
    })
  })
})

describe('all', () => {
  it('should combine two domain functions into one', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id + 1,
    )
    const b = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id - 1,
    )

    const c = all(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: true,
      data: [2, 0],
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('should use the same environment', async () => {
    const a = makeDomainFunction(
      z.undefined(),
      z.object({ toIncrement: z.number() }),
    )(async (_input, { toIncrement }) => toIncrement + 1)
    const b = makeDomainFunction(
      z.undefined(),
      z.object({ toDecrement: z.number() }),
    )(async (_input, { toDecrement }) => toDecrement - 1)

    const c = all(a, b)

    expect(await c(undefined, { toIncrement: 1, toDecrement: 1 })).toEqual({
      success: true,
      data: [2, 0],
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('should combine many domain functions into one', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(async ({ id }) =>
      String(id),
    )
    const b = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id + 1,
    )
    const c = makeDomainFunction(z.object({ id: z.number() }))(async ({ id }) =>
      Boolean(id),
    )

    const results = await all(a, b, c)({ id: 1 })

    expect(results).toEqual({
      success: true,
      data: ['1', 2, true],
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('should return error when one of the domain functions has input errors', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id,
    )
    const b = makeDomainFunction(z.object({ id: z.string() }))(
      async ({ id }) => id,
    )

    const c = all(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: false,
      inputErrors: [
        {
          message: 'Expected string, received number',
          path: ['id'],
        },
      ],
      errors: [],
      environmentErrors: [],
    })
  })

  it('should return error when one of the domain functions fails', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id,
    )
    const b = makeDomainFunction(z.object({ id: z.number() }))(async () => {
      throw new Error('Error')
    })

    const c = all(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: false,
      errors: [{ message: 'Error' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('should combine the inputError messages of both functions', async () => {
    const a = makeDomainFunction(z.object({ id: z.string() }))(
      async ({ id }) => id,
    )
    const b = makeDomainFunction(z.object({ id: z.string() }))(
      async ({ id }) => id,
    )

    const c = all(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: false,
      inputErrors: [
        {
          message: 'Expected string, received number',
          path: ['id'],
        },
        {
          message: 'Expected string, received number',
          path: ['id'],
        },
      ],
      environmentErrors: [],
      errors: [],
    })
  })

  it('should combine the error messages when both functions fail', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(async () => {
      throw new Error('Error A')
    })
    const b = makeDomainFunction(z.object({ id: z.number() }))(async () => {
      throw new Error('Error B')
    })

    const c = all(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: false,
      errors: [{ message: 'Error A' }, { message: 'Error B' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })
})

describe('pipe', () => {
  it('should compose domain functions from left-to-right', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => ({
        id: id + 2,
      }),
    )
    const b = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id - 1,
    )

    const c = pipe(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: true,
      data: 2,
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('should use the same environment in all composed functions', async () => {
    const a = makeDomainFunction(
      z.undefined(),
      z.object({ env: z.number() }),
    )(async (_input, { env }) => ({
      inp: env + 2,
    }))
    const b = makeDomainFunction(
      z.object({ inp: z.number() }),
      z.object({ env: z.number(), justToShowInference: z.string().optional() }),
    )(async ({ inp }, { env }) => inp + env)

    const c = pipe(a, b)

    expect(await c(undefined, { env: 1 })).toEqual({
      success: true,
      data: 4,
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('should fail on the first environment parser failure', async () => {
    const envParser = z.object({ env: z.number() })
    const a = makeDomainFunction(
      z.undefined(),
      envParser,
    )(async (_input, { env }) => ({
      inp: env + 2,
    }))
    const b = makeDomainFunction(
      z.object({ inp: z.number() }),
      envParser,
    )(async ({ inp }, { env }) => inp + env)

    const c = pipe(a, b)

    expect(await c(undefined, {})).toEqual({
      success: false,
      errors: [],
      inputErrors: [],
      environmentErrors: [{ message: 'Required', path: ['env'] }],
    })
  })

  it('should fail on the first input parser failure', async () => {
    const firstInputParser = z.undefined()

    const a = makeDomainFunction(
      firstInputParser,
      z.object({ env: z.number() }),
    )(async (_input, { env }) => ({
      inp: env + 2,
    }))
    const b = makeDomainFunction(
      z.object({ inp: z.number() }),
      z.object({ env: z.number() }),
    )(async ({ inp }, { env }) => inp + env)

    const c = pipe(a, b)

    expect(await c({ inp: 'some invalid input' }, { env: 1 })).toEqual({
      success: false,
      errors: [],
      inputErrors: [
        { message: 'Expected undefined, received object', path: [] },
      ],
      environmentErrors: [],
    })
  })

  it('should fail on the second input parser failure', async () => {
    const a = makeDomainFunction(
      z.undefined(),
      z.object({ env: z.number() }),
    )(async () => ({
      inp: 'some invalid input',
    }))
    const b = makeDomainFunction(
      z.object({ inp: z.number() }),
      z.object({ env: z.number() }),
    )(async ({ inp }, { env }) => inp + env)

    const c = pipe(a, b)

    expect(await c(undefined, { env: 1 })).toEqual({
      success: false,
      errors: [],
      inputErrors: [
        { message: 'Expected number, received string', path: ['inp'] },
      ],
      environmentErrors: [],
    })
  })

  it('should compose more than 2 functions', async () => {
    const a = makeDomainFunction(z.object({ aNumber: z.number() }))(
      async ({ aNumber }) => ({
        aString: String(aNumber),
      }),
    )
    const b = makeDomainFunction(z.object({ aString: z.string() }))(
      async ({ aString }) => ({
        aBoolean: aString == '1',
      }),
    )
    const c = makeDomainFunction(z.object({ aBoolean: z.boolean() }))(
      async ({ aBoolean }) => !aBoolean,
    )

    const d = pipe(a, b, c)

    expect(await d({ aNumber: 1 })).toEqual({
      success: true,
      data: false,
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })
})

describe('map', () => {
  it('returns a domain function function that will apply a function over the results of the first one', async () => {
    const a = makeDomainFunction(
      z.object({ id: z.number() }),
      z.object({ justToShowInference: z.string().optional() }),
    )(async ({ id }) => id + 1)
    const b = (id: number) => id + 1

    const c = map(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: true,
      data: 3,
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('returns the error when the domain function fails', async () => {
    const firstInputParser = z.object({ id: z.number() })
    const a = makeDomainFunction(firstInputParser)(async ({ id }) => id + 1)
    const b = (id: number) => id + 1

    const c = map(a, b)

    expect(await c({ invalidInput: '1' })).toEqual({
      success: false,
      errors: [],
      inputErrors: [{ message: 'Required', path: ['id'] }],
      environmentErrors: [],
    })
  })

  it('returns the error when the mapping function fails', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id + 1,
    )
    const b = () => {
      throw 'failed to map'
    }

    const c = map(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: false,
      errors: [{ message: 'failed to map' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })
})

describe('mapError', () => {
  it('returns the result when the domain function suceeds', async () => {
    const a = makeDomainFunction(
      z.object({ id: z.number() }),
      z.object({ justToShowInference: z.string().optional() }),
    )(async ({ id }) => id + 1)
    const b = () =>
      ({
        errors: [{ message: 'New Error Message' }],
        inputErrors: [{ message: 'New Input Error Message' }],
      } as ErrorData)

    const c = mapError(a, b)

    expect(await c({ id: 1 })).toEqual({
      success: true,
      data: 2,
      errors: [],
      inputErrors: [],
      environmentErrors: [],
    })
  })

  it('returns a domain function function that will apply a function over the error of the first one', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id + 1,
    )
    const b = (result: ErrorData) =>
      ({
        errors: [{ message: 'Number of errors: ' + result.errors.length }],
        inputErrors: [
          { message: 'Number of input errors: ' + result.inputErrors.length },
        ],
      } as ErrorData)

    const c = mapError(a, b)

    expect(await c({ invalidInput: '1' })).toEqual({
      success: false,
      errors: [{ message: 'Number of errors: 0' }],
      inputErrors: [{ message: 'Number of input errors: 1' }],
    })
  })

  it('returns the error when the mapping function fails', async () => {
    const a = makeDomainFunction(z.object({ id: z.number() }))(
      async ({ id }) => id + 1,
    )
    const b = () => {
      throw 'failed to map'
    }

    const c = mapError(a, b)

    expect(await c({ invalidInput: '1' })).toEqual({
      success: false,
      errors: [{ message: 'failed to map' }],
      inputErrors: [],
      environmentErrors: [],
    })
  })
})
