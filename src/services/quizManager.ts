import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface QuizOption {
  id: number;
  text: string;
}

export interface Quiz {
  id: string;
  question: string;
  options: QuizOption[];
  correctOptionId: number; // 1-based option ID
  explanation?: string;
  createdBy?: number;
  createdAt: string;
  isActive: boolean;
  totalAttempts: number;
  correctAnswersCount: number;
}

export interface UserPointRecord {
  userId: number;
  username?: string;
  firstName?: string;
  points: number;
  answeredQuizIds: string[];
  lastAnsweredAt?: string;
}

export interface QuizStoreData {
  activeQuizId: string | null;
  quizzes: Record<string, Quiz>;
  users: Record<string, UserPointRecord>;
}

export class QuizManager {
  private static instance: QuizManager;
  private filePath: string;
  private data: QuizStoreData;

  private constructor(customPath?: string) {
    this.filePath = customPath || path.resolve(process.cwd(), 'data', 'quiz_data.json');
    this.data = this.loadData();
  }

  public static getInstance(customPath?: string): QuizManager {
    if (!QuizManager.instance) {
      QuizManager.instance = new QuizManager(customPath);
    }
    return QuizManager.instance;
  }

  public static resetInstanceForTesting(customPath?: string): QuizManager {
    QuizManager.instance = new QuizManager(customPath);
    return QuizManager.instance;
  }

  private loadData(): QuizStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          activeQuizId: parsed.activeQuizId || null,
          quizzes: parsed.quizzes || {},
          users: parsed.users || {},
        };
      }
    } catch (err) {
      logger.warn('Failed to load quiz data file, initializing empty store', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      activeQuizId: null,
      quizzes: {},
      users: {},
    };
  }

  private saveData(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      logger.error('Failed to persist quiz data to disk', err);
    }
  }

  /**
   * Creates a new quiz and sets it as the active quiz.
   */
  public createQuiz(params: {
    question: string;
    options: string[];
    correctOptionId: number; // 1-based (e.g. 1 for first option)
    explanation?: string;
    adminId?: number;
  }): Quiz {
    const id = `quiz_${Date.now()}`;
    const quizOptions: QuizOption[] = params.options.map((text, idx) => ({
      id: idx + 1,
      text: text.trim(),
    }));

    // If an existing quiz was active, mark it inactive
    if (this.data.activeQuizId && this.data.quizzes[this.data.activeQuizId]) {
      this.data.quizzes[this.data.activeQuizId].isActive = false;
    }

    const quiz: Quiz = {
      id,
      question: params.question.trim(),
      options: quizOptions,
      correctOptionId: params.correctOptionId,
      explanation: params.explanation?.trim(),
      createdBy: params.adminId,
      createdAt: new Date().toISOString(),
      isActive: true,
      totalAttempts: 0,
      correctAnswersCount: 0,
    };

    this.data.quizzes[id] = quiz;
    this.data.activeQuizId = id;
    this.saveData();

    logger.info('New quiz created by admin', { quizId: id, adminId: params.adminId });
    return quiz;
  }

  /**
   * Retrieves the current active quiz, if any.
   */
  public getActiveQuiz(): Quiz | null {
    if (!this.data.activeQuizId) return null;
    const quiz = this.data.quizzes[this.data.activeQuizId];
    return quiz && quiz.isActive ? quiz : null;
  }

  /**
   * Retrieves a quiz by its ID.
   */
  public getQuizById(id: string): Quiz | null {
    return this.data.quizzes[id] || null;
  }

  /**
   * Closes the active quiz.
   */
  public closeActiveQuiz(): boolean {
    if (this.data.activeQuizId && this.data.quizzes[this.data.activeQuizId]) {
      this.data.quizzes[this.data.activeQuizId].isActive = false;
      this.data.activeQuizId = null;
      this.saveData();
      return true;
    }
    return false;
  }

  /**
   * Checks whether a user has already answered a specific quiz.
   */
  public hasUserAnswered(quizId: string, userId: number): boolean {
    const user = this.data.users[String(userId)];
    if (!user) return false;
    return user.answeredQuizIds.includes(quizId);
  }

  /**
   * Records a user's answer to a quiz and awards +1 point if correct.
   */
  public submitAnswer(params: {
    quizId: string;
    userId: number;
    optionId: number;
    username?: string;
    firstName?: string;
  }): {
    success: boolean;
    isCorrect: boolean;
    earnedPoint: boolean;
    totalPoints: number;
    alreadyAnswered?: boolean;
    correctOptionText?: string;
  } {
    const quiz = this.data.quizzes[params.quizId];
    if (!quiz) {
      return { success: false, isCorrect: false, earnedPoint: false, totalPoints: 0 };
    }

    const userKey = String(params.userId);
    let user = this.data.users[userKey];
    if (!user) {
      user = {
        userId: params.userId,
        username: params.username,
        firstName: params.firstName,
        points: 0,
        answeredQuizIds: [],
      };
      this.data.users[userKey] = user;
    } else {
      // Update username/firstName if changed
      if (params.username) user.username = params.username;
      if (params.firstName) user.firstName = params.firstName;
    }

    if (user.answeredQuizIds.includes(params.quizId)) {
      return {
        success: false,
        isCorrect: false,
        earnedPoint: false,
        totalPoints: user.points,
        alreadyAnswered: true,
      };
    }

    // Mark as answered for this quiz
    user.answeredQuizIds.push(params.quizId);
    user.lastAnsweredAt = new Date().toISOString();
    quiz.totalAttempts += 1;

    const isCorrect = params.optionId === quiz.correctOptionId;
    let earnedPoint = false;

    if (isCorrect) {
      user.points += 1;
      quiz.correctAnswersCount += 1;
      earnedPoint = true;
    }

    this.saveData();

    const correctOpt = quiz.options.find((o) => o.id === quiz.correctOptionId);

    return {
      success: true,
      isCorrect,
      earnedPoint,
      totalPoints: user.points,
      correctOptionText: correctOpt?.text,
    };
  }

  /**
   * Returns a user's point record and their community leaderboard rank.
   */
  public getUserPoints(userId: number): {
    points: number;
    quizzesAnswered: number;
    rank: number;
    totalParticipants: number;
  } {
    const user = this.data.users[String(userId)];
    const points = user ? user.points : 0;
    const quizzesAnswered = user ? user.answeredQuizIds.length : 0;

    // Calculate leaderboard rank
    const allUsers = Object.values(this.data.users);
    const sorted = allUsers.sort((a, b) => b.points - a.points);
    const rankIndex = sorted.findIndex((u) => u.userId === userId);
    const rank = rankIndex >= 0 ? rankIndex + 1 : sorted.length + 1;

    return {
      points,
      quizzesAnswered,
      rank,
      totalParticipants: Math.max(allUsers.length, 1),
    };
  }

  /**
   * Returns top users for the community leaderboard.
   */
  public getLeaderboard(limit = 5): Array<{
    userId: number;
    username?: string;
    firstName?: string;
    points: number;
  }> {
    const allUsers = Object.values(this.data.users);
    return allUsers
      .filter((u) => u.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }
}

export const quizManager = QuizManager.getInstance();
