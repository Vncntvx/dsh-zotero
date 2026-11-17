/** A host Button whose block size follows multiline content; host size owns padding and type. */
import { forwardRef, type ComponentProps } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

/** Feature classes carry layout; this adapter owns the single intrinsic-size override. */
export const ContentButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof Button>, 'style'>
>(function ContentButton(props, ref) {
  return <Button {...props} ref={ref} style={{ height: 'auto' }} />
})
