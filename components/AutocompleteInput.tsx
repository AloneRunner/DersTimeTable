import React, { useState, useEffect, useRef } from 'react';

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  required?: boolean;
  multi?: boolean;
}

export const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  value,
  onChange,
  suggestions,
  multi = false,
  ...rest
}) => {
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const userInput = e.currentTarget.value;
    onChange(userInput);

    if (!userInput) {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const searchInput = multi
      ? userInput.substring(userInput.lastIndexOf(',') + 1).trim()
      : userInput;

    if (searchInput) {
      const filtered = suggestions.filter(
        suggestion =>
          suggestion.toLowerCase().indexOf(searchInput.toLowerCase()) > -1
      );
      setFilteredSuggestions(filtered.slice(0, 10)); // Limit to 10 suggestions
      setShowSuggestions(true);
    } else {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const onSuggestionClick = (suggestion: string) => {
    let newValue;
    if (multi) {
      const lastCommaIndex = value.lastIndexOf(',');
      if (lastCommaIndex === -1) {
          newValue = suggestion;
      } else {
          const base = value.substring(0, lastCommaIndex + 1);
          newValue = (base + ' ' + suggestion).trim();
      }
    } else {
      newValue = suggestion;
    }
    onChange(newValue);
    setFilteredSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => {
            const searchInput = multi ? value.substring(value.lastIndexOf(',') + 1).trim() : value;
            if (searchInput) {
                const filtered = suggestions.filter(s => s.toLowerCase().indexOf(searchInput.toLowerCase()) > -1);
                setFilteredSuggestions(filtered.slice(0, 10));
                setShowSuggestions(true);
            }
        }}
        {...rest}
      />
      {showSuggestions && filteredSuggestions.length > 0 && (
        <ul className="absolute z-10 w-full bg-white border border-slate-300 rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
          {filteredSuggestions.map((suggestion, index) => (
            <li
              key={suggestion + index}
              onClick={() => onSuggestionClick(suggestion)}
              className="px-4 py-2 cursor-pointer hover:bg-sky-50"
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
