/**
 * `slots.provideRoot` double for the bare apply-world context: records the
 * current root props and restores the previous contribution on disposal.
 * @module tests/client/helpers/fake-slot-root
 */

/** The slice of a fake world this double mutates. */
export interface RootPropsHost {
  rootProps?: Record<string, unknown>
}

/** Build the `provideRoot` member for `fakeWorld`. */
export function fakeProvideRoot(host: RootPropsHost) {
  return (contribution: { props?: Record<string, unknown> }) => {
    const previous = host.rootProps
    host.rootProps = contribution.props
    return () => {
      if (host.rootProps === contribution.props) host.rootProps = previous
    }
  }
}
