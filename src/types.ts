type ErrorWithMessage = {
  message: string
}

type SuccessResult<T = void> = {
  success: true
  data: T
  errors: []
  inputErrors: []
  environmentErrors: []
}
type ErrorResult = {
  success: false
  errors: ErrorWithMessage[]
  inputErrors: SchemaError[]
  environmentErrors: SchemaError[]
}
type SchemaError = {
  path: string[]
  message: string
}

type ErrorData = Omit<ErrorResult, 'success'>

type Result<T = void> = SuccessResult<T> | ErrorResult

type DomainFunction<Output = unknown, Environment = unknown> = {
  (input: unknown, environment?: Environment): Promise<Result<Output>>
}

type UnpackResult<F extends DomainFunction> = Awaited<ReturnType<F>>
type UnpackSuccess<F extends DomainFunction> = Extract<
  UnpackResult<F>,
  { success: true }
>
type UnpackData<F extends DomainFunction> = UnpackSuccess<F>['data']

export type {
  DomainFunction,
  Result,
  SchemaError,
  SuccessResult,
  ErrorResult,
  ErrorData,
  UnpackResult,
  UnpackSuccess,
  UnpackData,
  ErrorWithMessage,
}
