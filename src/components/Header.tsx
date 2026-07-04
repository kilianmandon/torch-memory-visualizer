import styles from '../css/Header.module.css';

interface HeaderProps {
    githubUrl: string;
}

export default function Header({githubUrl}: HeaderProps) {
    return (
        <header className={styles.header}>
            <div className={styles.project}>
                <div className={styles.project}>Torch Memory Visualizer</div>
                <div className={styles.tagline}>
                    Source-level heap snapshot exploration
                </div>
            </div>
            <a
                href={githubUrl}
                target="_blank" 
                rel="noopener noreferrer"
                className={styles.link}
                >
                GitHub
            </a>
        </header>
    )
}