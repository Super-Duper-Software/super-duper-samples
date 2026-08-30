// Public surface of the auth subsystem. `src/core/index.ts` wires it into
// `createCore`; `src/main/` provides the real `AuthPlatform` + `Scheduler`.

export {
  createAuthController,
  LOOPBACK_PORT,
  REDIRECT_URI,
  type AuthController,
  type AuthControllerDeps,
  type AuthState,
  type AuthStatus,
} from './authController'
export {
  createRealScheduler,
  type Scheduler,
} from './scheduler'
export type {
  AuthPlatform,
  AwaitLoopbackCodeOptions,
  LoopbackResult,
} from './platform'
export {
  LoopbackPortInUseError,
  OAuthStateMismatchError,
  ReauthRequiredError,
  RetryableTokenError,
  SignInCancelledError,
} from './errors'
