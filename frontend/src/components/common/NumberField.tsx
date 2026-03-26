import React, { useEffect, useState } from 'react';
import TextField, { TextFieldProps } from '@mui/material/TextField';

interface NumberFieldProps extends Omit<TextFieldProps, 'value' | 'onChange' | 'type'> {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Allow decimal (floating-point) entry. Default: integers only. */
  allowDecimal?: boolean;
}

const NumberField: React.FC<NumberFieldProps> = ({ value, onChange, min = 0, max, allowDecimal = false, onBlur, ...rest }) => {
  const [input, setInput] = useState<string>('');

  // Sync when external value changes (only when it materially differs from parsed input)
  useEffect(() => {
    if (value === null || value === undefined) {
      setInput('');
    } else if (!Number.isNaN(value)) {
      // Don't overwrite a valid partial entry (e.g. "12." while typing "12.5")
      const parsed = allowDecimal ? parseFloat(input) : parseInt(input, 10);
      if (isNaN(parsed) || parsed !== value) {
        setInput(String(value));
      }
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const valid = allowDecimal
      ? val === '' || /^\d*\.?\d*$/.test(val)   // allow "12", "12.", "12.5", ".5"
      : val === '' || /^\d+$/.test(val);          // integers only

    if (valid) {
      setInput(val);
      if (val !== '' && val !== '.') {
        const num = allowDecimal ? parseFloat(val) : parseInt(val, 10);
        if (!Number.isNaN(num)) {
          if (max !== undefined && num > max) {
            onChange(max);
            setInput(String(max));
          } else {
            onChange(num);
          }
        }
      }
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (input === '' || input === '.') {
      if (min !== undefined && min > 0) {
        setInput(String(min));
        onChange(min);
      } else {
        setInput('');
        onChange(null);
      }
    } else {
      let num = allowDecimal ? parseFloat(input) : parseInt(input, 10);
      if (Number.isNaN(num)) num = min;
      if (num < min) num = min;
      if (max !== undefined && num > max) num = max;
      const normalised = allowDecimal ? String(num) : String(num);
      if (normalised !== input) setInput(normalised);
      onChange(num);
    }
    onBlur?.(e);
  };

  return (
    <TextField
      {...rest}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={input}
      onChange={handleChange}
      onBlur={handleBlur}
      inputProps={{ ...rest.inputProps, min, max }}
    />
  );
};

export default NumberField;
