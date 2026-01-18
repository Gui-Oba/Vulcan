const SectionCard = ({ className, children, chat }) => {
  const raised = Boolean(chat);
  return (
    <section className={`${className} relative ${raised ? "z-40" : ""}`}>
      {children}
      {chat}
    </section>
  );
};

export default SectionCard;
