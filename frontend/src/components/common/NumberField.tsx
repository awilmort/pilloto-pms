import React, { useEffect, useState } from 'react';
import TextField, { TextFieldProps } from '@mui/material/TextField';

interface NumberFieldProps extends Omit<TextFieldProps, 'value' | 'onChange' | 'type'> {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
}

const NumberField: React.FC<NumberFieldProps> = ({ value, onChange, min = 0, max, onBlur, ...rest }) => {
  const [input, setInput] = useState<string>('');

  // Sync when external value changes
  useEffect(() => {
    if (value === null || value === undefined) {
      setInput('');
    } else if (!Number.isNaN(value)) {
      setInput(String(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty and digits only
    if (val === '' || /^\d+$/.test(val)) {
      setInput(val);
      if (val !== '') {
        const num = Number(val);
        if (max !== undefined && num > max) {
          onChange(max);
          setInput(String(max));
        } else {
          onChange(num);
        }
      }
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (input === '') {
      // If a minimum is defined (> 0), enforce it on blur
      if (min !== undefined && min > 0) {
        const enforced = min;
        setInput(String(enforced));
        onChange(enforced);
      } else {
        // Otherwise propagate as null
        onChange(null);
      }
    } else {
      let num = Number(input);
      if (Number.isNaN(num)) {
        num = min;
      }
      if (num < min) num = min;
      if (max !== undefined && num > max) num = max;
      if (String(num) !== input) {
        setInput(String(num));
      }
      onChange(num);
    }
    onBlur?.(e);
  };

  return (
    <TextField
      {...rest}
      type="number"
      value={input}
      onChange={handleChange}
      onBlur={handleBlur}
      inputProps={{ ...rest.inputProps, min, max }}
    />
  );
};

export default NumberField;
