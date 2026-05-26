// src/contexts/VerimeterModeContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type VerimeterMode = 'ai' | 'user' | 'combined';
export type PopupStyle = 'card' | 'bar';

interface VerimeterModeContextType {
  mode: VerimeterMode;
  setMode: (mode: VerimeterMode) => void;
  aiWeight: number;
  setAIWeight: (weight: number) => void;
  popupStyle: PopupStyle;
  setPopupStyle: (style: PopupStyle) => void;
}

const VerimeterModeContext = createContext<VerimeterModeContextType | undefined>(undefined);

interface VerimeterModeProviderProps {
  children: ReactNode;
}

export const VerimeterModeProvider: React.FC<VerimeterModeProviderProps> = ({ children }) => {
  // Load from localStorage or default to 'combined' (AI + User ratings)
  const [mode, setModeState] = useState<VerimeterMode>(() => {
    const saved = localStorage.getItem('verimeterMode');
    return (saved as VerimeterMode) || 'combined';
  });

  const [aiWeight, setAIWeightState] = useState<number>(() => {
    const saved = localStorage.getItem('verimeterAIWeight');
    return saved ? parseFloat(saved) : 0.5;
  });

  const [popupStyle, setPopupStyleState] = useState<PopupStyle>(() => {
    const saved = localStorage.getItem('popupStyle');
    return (saved as PopupStyle) || 'card';
  });

  // Persist to localStorage when values change
  useEffect(() => {
    localStorage.setItem('verimeterMode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('verimeterAIWeight', aiWeight.toString());
  }, [aiWeight]);

  useEffect(() => {
    localStorage.setItem('popupStyle', popupStyle);
  }, [popupStyle]);

  const setMode = (newMode: VerimeterMode) => {
    setModeState(newMode);
  };

  const setAIWeight = (weight: number) => {
    setAIWeightState(Math.max(0, Math.min(1, weight)));
  };

  const setPopupStyle = (style: PopupStyle) => {
    setPopupStyleState(style);
  };

  return (
    <VerimeterModeContext.Provider value={{ mode, setMode, aiWeight, setAIWeight, popupStyle, setPopupStyle }}>
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
