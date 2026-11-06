import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui-style button, sized for elderly users: large text, ≥56px touch targets, strong focus ring. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-3 rounded-2xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-blue-700 text-white shadow-sm hover:bg-blue-800 active:bg-blue-900",
        secondary: "border-2 border-slate-300 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100",
        ghost: "text-blue-800 hover:bg-blue-50 active:bg-blue-100",
        danger: "border-2 border-red-200 bg-white text-red-700 hover:bg-red-50",
        success: "bg-green-700 text-white shadow-sm hover:bg-green-800",
      },
      size: {
        lg: "min-h-14 px-5 py-2.5 text-lg [&_svg]:size-6",
        md: "min-h-12 px-4 py-2 text-base [&_svg]:size-5",
        sm: "min-h-11 px-3 py-1.5 text-base [&_svg]:size-5",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "lg", block: false },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, block, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
});
Button.displayName = "Button";
