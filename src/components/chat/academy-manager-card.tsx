import Image from "next/image";

import type {
  AcademyContactCard,
} from "@/lib/chat-contract";

type AcademyManagerCardProps = {
  card: AcademyContactCard;
};

export function AcademyManagerCard({
  card,
}: AcademyManagerCardProps) {
  return (
    <aside
      className="manager-card"
      aria-label={`Контакт менеджера Академии ${card.name}`}
    >
      <Image
        className="manager-card__photo"
        src={card.imageUrl}
        alt="Алексей Лебедев, менеджер Академии"
        width={96}
        height={96}
        sizes="96px"
      />
      <div className="manager-card__body">
        <p className="manager-card__name">{card.name}</p>
        <p className="manager-card__role">{card.role}</p>
        <p className="manager-card__availability">
          {card.availability}
        </p>
        <div className="manager-card__actions">
          <a
            className="manager-card__action"
            href={card.telegram.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram {card.telegram.label}
          </a>
          <a
            className="manager-card__action"
            href={card.phone.href}
          >
            {card.phone.label}
          </a>
        </div>
      </div>
    </aside>
  );
}
