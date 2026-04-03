// src/contexts/VerimeterModeContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type VerimeterMode = 'ai' | 'user' | 'combined';

interface VerimeterModeContextType {
  mode: VerimeterMode;
  setMode: (mode: VerimeterMode) => void;
  aiWeight: number;
  setAIWeight: (weight: number) => void;
}

const VerimeterModeContext = createContext<VerimeterModeContextType | undefined>(undefined);

interface VerimeterModeProviderProps {
  children: ReactNode;
}

export const VerimeterModeProvider: React.FC<VerimeterModeProviderProps> = ({ children }) => {
  // Load from localStorage or default to 'user'
  const [mode, setModeState] = useState<VerimeterMode>(() => {
    const saved = localStorage.getItem('verimeterMode');
    return (saved as VerimeterMode) || 'user';
  });

  const [aiWeight, setAIWeightState] = useState<number>(() => {
    const saved = localStorage.getItem('verimeterAIWeight');
    return saved ? parseFloat(saved) : 0.5;
  });

  // Persist to localStorage when mode changes
  useEffect(() => {
    localStorage.setItem('verimeterMode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('verimeterAIWeight', aiWeight.toString());
  }, [aiWeight]);

  const setMode = (newMode: VerimeterMode) => {
    setModeState(newMode);
  };

  const setAIWeight = (weight: number) => {
    setAIWeightState(Math.max(0, Math.min(1, weight)));
  };

  return (
    <VerimeterModeContext.Provider value={{ mode, setMode, aiWeight, setAIWeight }}>
      {children}
    </VerimeterModeContext.Provider>
  );
};

export const useVerimeterMode = (): VerimeterModeContextType => {
  const context = useContext(VerimeterModeContext);
  if (context === undefined) {
    throw new Error('useVerimeterMode must be used within a VerimeterModeProvider');
  }
  return context;
};
