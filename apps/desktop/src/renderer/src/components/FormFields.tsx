import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  children: ReactNode;
};

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
};

type ToggleProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function TextInput({ label, error, id, ...props }: InputProps) {
  const fieldId = id ?? props.name;

  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <input id={fieldId} className="input" {...props} />
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

export function SelectInput({ label, error, id, children, ...props }: SelectProps) {
  const fieldId = id ?? props.name;

  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <select id={fieldId} className="input" {...props}>
        {children}
      </select>
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

export function TextareaInput({ label, error, id, ...props }: TextareaProps) {
  const fieldId = id ?? props.name;

  return (
    <label className="field field--wide" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <textarea id={fieldId} className="input input--textarea" {...props} />
      {error ? <span className="field__error">{error}</span> : null}
    </label>
  );
}

export function ToggleInput({ label, ...props }: ToggleProps) {
  return (
    <label className="toggle-row">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
