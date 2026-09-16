import * as React from "react";
import styles from "./ui.module.css";

interface BadgeProps extends React.ComponentProps<"span"> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning';
}

export function Badge({ className = "", variant = 'default', ...props }: BadgeProps) {
  return (
    <span 
      className={`${styles.badge} ${styles[`badge-${variant}`]} ${className}`} 
      {...props} 
    />
  );
}
