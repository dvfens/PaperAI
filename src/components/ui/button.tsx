import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui-style button at normal phone-app sizes (48 / 40 / 36 px tall) with a strong focus ring. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-blue-700 text-white shadow-sm hover:bg-blue-800 active:bg-blue-900",
        secondary: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100",
        ghost: "text-blue-800 hover:bg-blue-50 active:bg-blue-100",
        danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        success: "bg-green-700 text-white shadow-sm hover:bg-green-800",
      },
      size: {
        lg: "min-h-12 px-4 py-2 text-base [&_svg]:size-5",
        md: "min-h-10 px-4 py-1.5 text-[15px] [&_svg]:size-[18px]",
        sm: "min-h-9 px-3 py-1 text-sm [&_svg]:size-4",
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
