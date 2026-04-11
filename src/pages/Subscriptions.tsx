import PageHeader from '@/components/PageHeader';
import JobSubscriptions from '@/components/JobSubscriptions';

const SubscriptionsPage = () => {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Job Subscriptions"
        description="Monitor companies, careers pages, and keywords for new job listings automatically."
      />
      <JobSubscriptions />
    </div>
  );
};

export default SubscriptionsPage;
