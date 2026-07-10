import styles from '../css/Placeholder.module.css';
interface PlaceholderProps {
    title: string;
    subtitle?: string;
    loading?: boolean;
    progress?: number;
}

export default function Placeholder({ title, subtitle, loading = false, progress }: PlaceholderProps) {
    const showProgressBar = typeof progress === 'number';
    return (
        <div className={styles.placeholder}>
            {loading && <div className={styles.spinner} />}
            <div className={styles.title}>{title}</div>
            {
                subtitle &&
                <div className={styles.subtitle}>{subtitle}</div>
            }
            {showProgressBar && (
                <div className={styles.progressContainer}>
                    <div className={styles.progressBar}
                        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                    <span className={styles.progressText}>{Math.round(progress)}%</span>
                </div>
            )
            }
        </div>
    )
};