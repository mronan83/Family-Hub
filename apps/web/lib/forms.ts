import { type FormEvent, startTransition, useActionState } from 'react';

/**
 * useActionState for the admin forms, without React's automatic reset after a form action: a
 * refused sign-in or setup keeps what the person typed, so they fix one field instead of retyping
 * every one. Spread the returned handler as the form's onSubmit (client components only). The button
 * that submitted is included, so a form can offer two (for example "Save" and "Save and add another").
 */
export function useFormAction<S extends object>(
  action: (prev: S, form: FormData) => Promise<S>,
  initial: S,
): [S, (event: FormEvent<HTMLFormElement>) => void, boolean] {
  const [state, dispatch, pending] = useActionState<S, FormData>(
    action as (prev: Awaited<S>, form: FormData) => Promise<S>,
    initial as Awaited<S>,
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(form));
  };
  return [state as S, onSubmit, pending];
}
