import * as React from "react";
import styles from "./ui.module.css";

interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function Button({ className = "", variant = 'default', size = 'default', ...props }: ButtonProps) {
  return (
    <button 
      className={`${styles.button} ${styles[`button-${variant}`]} ${styles[`button-${size}`]} ${className}`} 
      {...props} 
    />
  );
}
