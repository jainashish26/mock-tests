import * as React from "react";
import styles from "./ui.module.css";

export function Card({ className = "", children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={`${styles.card} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className = "", ...props }: React.ComponentProps<"div">) {
  return <div className={`${styles.cardHeader} ${className}`} {...props} />;
}

export function CardTitle({ className = "", ...props }: React.ComponentProps<"h4">) {
  return <h4 className={`${styles.cardTitle} ${className}`} {...props} />;
}

export function CardDescription({ className = "", ...props }: React.ComponentProps<"p">) {
  return <p className={`${styles.cardDescription} ${className}`} {...props} />;
}

export function CardContent({ className = "", ...props }: React.ComponentProps<"div">) {
  return <div className={`${styles.cardContent} ${className}`} {...props} />;
}

export function CardFooter({ className = "", ...props }: React.ComponentProps<"div">) {
  return <div className={`${styles.cardFooter} ${className}`} {...props} />;
}
