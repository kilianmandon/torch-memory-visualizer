import styles from '../css/Placeholder.module.css';
interface PlaceholderProps {
    title: string;
    subtitle?: string;
    loading?: boolean;
}

export default function Placeholder({ title, subtitle, loading = false }: PlaceholderProps) {
    return (
        <div className={styles.placeholder}>
            {loading && <div className={styles.spinner} />}
            <div className={styles.title}>{title}</div>
            {
                subtitle &&
                <div className={styles.subtitle}>{subtitle}</div>
            }
        </div>
    )
};