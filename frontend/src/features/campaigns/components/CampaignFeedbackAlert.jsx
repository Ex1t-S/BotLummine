export default function CampaignFeedbackAlert({ feedback }) {
	if (!feedback) return null;

	return <div className={`campaign-feedback ${feedback.type}`}>{feedback.message}</div>;
}
