import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

const PageHeader = ({ title, description, actions }: PageHeaderProps) => (
  <div className="flex flex-col gap-3 mb-6">
    <div>
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {description && <p className="text-xs sm:text-sm text-muted-foreground mt-1">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

export default PageHeader;
