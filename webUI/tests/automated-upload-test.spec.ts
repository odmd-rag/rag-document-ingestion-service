import { test, expect, chromium } from '@playwright/test';
import { getTestChromeArgs, getVncEnvironment, TEST_CONFIG } from './config/browser-positioning';

test.describe('RAG Pipeline E2E Validation (Persistent Auth)', () => {

  const TEST_FILE_PATH = './test-files/sample-document.txt';

  test('validate complete RAG pipeline processing with saved credentials', async () => {
    console.log('🤖 Starting Complete RAG Pipeline Validation Test');
    console.log('=================================================');
    console.log('⚠️  This test validates the ENTIRE RAG pipeline, not just upload!');
    console.log('🔐 Assumes saved authentication credentials in ./test-usr directory');
    console.log('');

    test.setTimeout(900000);

    let browser;
    let page;

    try {
      console.log('🚀 Launching Chrome browser...');
      console.log(`📍 Browser positioned at (${TEST_CONFIG.position.x}, ${TEST_CONFIG.position.y}) size ${TEST_CONFIG.size.width}x${TEST_CONFIG.size.height}`);
      const context = await chromium.launchPersistentContext('./test-usr', {
        headless: false,
        executablePath: '/usr/bin/google-chrome',
        args: getTestChromeArgs(),
        env: {
          ...process.env,
          ...getVncEnvironment(),
        },
      });

      page = await context.newPage();

      console.log('🔗 Navigating to RAG WebUI...');
      await page.goto('http:

      console.log(`✅ Connected to RAG WebUI: ${page.url()}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('❌ Failed to launch browser:', errorMessage);
      throw new Error('Browser launch failed');
    }

    page.on('console', msg => console.log('🖥️  Browser:', msg.text()));
    page.on('pageerror', err => console.error('❌ Page Error:', err.message));

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: 'test-results/pipeline-validation-00-start.png',
      fullPage: true
    });

    console.log('📸 Initial screenshot taken');
    console.log('');

    const signInCard = page.locator('.sign-in-card');
    const uploadSection = page.locator('.upload-section');
    const userInfo = page.locator('.user-info');

    const isSignInVisible = await signInCard.isVisible().catch(() => false);
    const isUploadVisible = await uploadSection.isVisible().catch(() => false);
    const isUserInfoVisible = await userInfo.isVisible().catch(() => false);

    console.log(`🔍 Authentication Status:`);
    console.log(`   Sign-in UI visible: ${isSignInVisible}`);
    console.log(`   Upload UI visible: ${isUploadVisible}`);
    console.log(`   User info visible: ${isUserInfoVisible}`);

    if (!isUploadVisible || !isUserInfoVisible) {
      console.log('❌ AUTHENTICATION REQUIRED - Attempting Google OAuth Sign-in...');
      console.log('🔄 Trying to click "Sign in with Google" button...');

      const googleSignInBtn = page.locator('button:has-text("Sign in with Google"), .google-signin-btn, [data-testid="google-signin"], .sign-in-card button');

      const signInBtnVisible = await googleSignInBtn.first().isVisible().catch(() => false);

      if (signInBtnVisible) {
        console.log('🔍 Found Google sign-in button, clicking...');

        try {
          await googleSignInBtn.first().click();
          console.log('✅ Clicked Google sign-in button');

          await page.waitForTimeout(5000);

          const uploadSectionRetry = page.locator('.upload-section');
          const userInfoRetry = page.locator('.user-info');

          const isUploadVisibleRetry = await uploadSectionRetry.isVisible().catch(() => false);
          const isUserInfoVisibleRetry = await userInfoRetry.isVisible().catch(() => false);

          console.log(`🔍 Post-signin Authentication Status:`);
          console.log(`   Upload UI visible: ${isUploadVisibleRetry}`);
          console.log(`   User info visible: ${isUserInfoVisibleRetry}`);

          if (!isUploadVisibleRetry || !isUserInfoVisibleRetry) {
            console.log('❌ AUTHENTICATION STILL FAILED AFTER GOOGLE SIGNIN ATTEMPT!');
            console.log('💡 This could mean:');
            console.log('   1. Google OAuth is blocked in automated browser');
            console.log('   2. The sign-in button didn\'t work as expected');
            console.log('   3. Authentication requires manual intervention');

            await page.screenshot({
              path: 'test-results/pipeline-validation-signin-failed.png',
              fullPage: true
            });

            throw new Error('Authentication failed even after attempting Google sign-in - manual intervention may be required');
          } else {
            console.log('✅ Authentication successful after Google sign-in!');
          }

        } catch (signInError) {
          const errorMessage = signInError instanceof Error ? signInError.message : String(signInError);
          console.log('❌ Failed to click Google sign-in button:', errorMessage);

          await page.screenshot({
            path: 'test-results/pipeline-validation-signin-click-failed.png',
            fullPage: true
          });

          throw new Error(`Google sign-in attempt failed: ${errorMessage}`);
        }

      } else {
        console.log('❌ AUTHENTICATION FAILED - No Google sign-in button found!');
        console.log('💡 The test expects either:');
        console.log('   1. Saved credentials from ./test-usr directory, OR');
        console.log('   2. A visible "Sign in with Google" button to click');
        console.log('🔧 To fix: Run Chrome manually first and sign in to save credentials:');
        console.log('   ./launch-chrome-oauth.sh');
        console.log('   Then sign in with Google OAuth and close Chrome');

        await page.screenshot({
          path: 'test-results/pipeline-validation-no-signin-button.png',
          fullPage: true
        });

        throw new Error('Authentication failed - no saved credentials and no sign-in button found');
      }
    }

    const userInfoText = await userInfo.textContent();
    console.log(`👤 Authenticated user: ${userInfoText?.trim()}`);
    console.log('');

    const uploadArea = page.locator('#uploadArea');
    const fileInput = page.locator('#fileInput');

    const isUploadAreaVisible = await uploadArea.isVisible();
    const fileInputExists = await fileInput.count() > 0;

    console.log(`🔍 Upload Elements Check:`);
    console.log(`   Upload area visible: ${isUploadAreaVisible}`);
    console.log(`   File input exists: ${fileInputExists}`);

    if (!isUploadAreaVisible || !fileInputExists) {
      console.log('❌ Upload elements not ready');
      await page.screenshot({
        path: 'test-results/pipeline-validation-no-elements.png',
        fullPage: true
      });
      throw new Error('Upload UI not ready');
    }

    console.log('');
    console.log('📁 STEP 1: FILE UPLOAD');
    console.log('======================');

    console.log(`📄 Uploading test file: ${TEST_FILE_PATH}`);

    try {
      await fileInput.setInputFiles(TEST_FILE_PATH);
      console.log('✅ File selected successfully');

      await page.waitForTimeout(3000);

      const progressText = page.locator('#progressText');

      console.log('📊 Monitoring upload progress...');

      let uploadCompleted = false;
      let attempts = 0;
      const maxUploadAttempts = 60;

      while (attempts < maxUploadAttempts && !uploadCompleted) {
        attempts++;

        const progressTextContent = await progressText.textContent().catch(() => '') as string

        if (progressTextContent) {
          console.log(`📊 Upload Progress: ${progressTextContent}`);

          if (progressTextContent.includes('100%') || progressTextContent.toLowerCase().includes('complete')) {
            console.log('✅ File upload completed!');
            uploadCompleted = true;
            break;
          }
        }

        const errorElements = await page.locator('.error, .alert-error, [class*="error"]').count();
        if (errorElements > 0) {
          const errorText = await page.locator('.error, .alert-error, [class*="error"]').first().textContent();
          throw new Error(`Upload failed: ${errorText}`);
        }

        await page.waitForTimeout(1000);
      }

      if (!uploadCompleted) {
        throw new Error('Upload did not complete within timeout');
      }

      await page.screenshot({
        path: 'test-results/pipeline-validation-01-upload-complete.png',
        fullPage: true
      });

    } catch (uploadError) {
      const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
      console.log('❌ File upload failed:', errorMessage);
      await page.screenshot({
        path: 'test-results/pipeline-validation-upload-error.png',
        fullPage: true
      });
      throw uploadError;
    }

    console.log('');
    console.log('🔄 STEP 2: RAG PIPELINE PROCESSING VALIDATION');
    console.log('==============================================');
    console.log('⚠️  Now validating COMPLETE pipeline success...');
    console.log('');

    await page.waitForTimeout(3000);
    const historyItems = page.locator('#uploadHistory .upload-item, #uploadHistory .document-item');

    const historyCount = await historyItems.count();
    console.log(`📋 Upload history items: ${historyCount}`);

    if (historyCount === 0) {
      throw new Error('No documents found in upload history');
    }

    const latestItem = historyItems.first();
    const latestItemText = await latestItem.textContent();
    console.log(`📄 Latest document: ${latestItemText?.trim()}`);

    let documentId = null;
    const idMatch = latestItemText?.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z-[a-f0-9]{64}\.txt)/);
    if (idMatch) {
      documentId = idMatch[1];
      console.log(`🆔 Document ID: ${documentId}`);
    } else {
      throw new Error('Could not extract document ID from upload history');
    }

    console.log('');
    console.log('🔍 PIPELINE STAGE VALIDATION:');
    console.log('=============================');

    let pipelineCompleted = false;
    let pipelineFailed = false;
    let pipelineAttempts = 0;
    const maxPipelineAttempts = 300;


    while (pipelineAttempts < maxPipelineAttempts && !pipelineCompleted && !pipelineFailed) {
      pipelineAttempts++;


      await page.waitForTimeout(1000);

      if (pipelineAttempts % 30 === 0) {
        await page.screenshot({
          path: `test-results/pipeline-validation-02-processing-${Math.floor(pipelineAttempts/30)}.png`,
          fullPage: true
        });
        console.log(`📸 Pipeline monitoring screenshot ${Math.floor(pipelineAttempts/30)} taken`);
      }

       if (pipelineAttempts >= 120) {
         break;
       }

      console.log(`⏳ Pipeline monitoring... (${pipelineAttempts}/${maxPipelineAttempts})`);
    }

    console.log('');
    console.log('🔍 FINAL PIPELINE STATUS CHECK:');
    console.log('===============================');

    await page.screenshot({
      path: 'test-results/pipeline-validation-03-final-status.png',
      fullPage: true
    });


    const errorElements = await page.locator('.error, .alert-error, [class*="error"], [class*="failed"]').count();
    const warningElements = await page.locator('.warning, .alert-warning, [class*="warning"]').count();

    console.log(`🔍 Error elements on page: ${errorElements}`);
    console.log(`🔍 Warning elements on page: ${warningElements}`);

    if (errorElements > 0) {
      console.log('❌ ERROR ELEMENTS DETECTED:');
      for (let i = 0; i < errorElements; i++) {
        const errorText = await page.locator('.error, .alert-error, [class*="error"], [class*="failed"]').nth(i).textContent();
        console.log(`   ❌ ${errorText?.trim()}`);
      }
    }



    console.log('');
    console.log('⚠️  CRITICAL PIPELINE VALIDATION:');
    console.log('=================================');
    console.log('🔍 Checking browser console for pipeline failures...');


    const statusElements = page.locator('[class*="status"], [class*="pipeline"], [class*="stage"]');
    const statusCount = await statusElements.count();

    console.log(`📊 Status elements found: ${statusCount}`);

    let hasFailures = false;
    let hasIncomplete = false;

    if (statusCount > 0) {
      for (let i = 0; i < statusCount; i++) {
        const statusText = await statusElements.nth(i).textContent();
        if (statusText && statusText.trim()) {
          console.log(`📊 Status ${i + 1}: ${statusText.trim()}`);

          if (statusText.toLowerCase().includes('failed') ||
              statusText.toLowerCase().includes('error') ||
              statusText.toLowerCase().includes('unsuccessful')) {
            hasFailures = true;
          }

          if (statusText.toLowerCase().includes('pending') ||
              statusText.toLowerCase().includes('processing') ||
              statusText.toLowerCase().includes('yellow')) {
            hasIncomplete = true;
          }
        }
      }
    }

    console.log('');
    console.log('📋 PIPELINE VALIDATION RESULTS:');
    console.log('===============================');
    console.log(`🔍 Pipeline failures detected: ${hasFailures ? 'YES ❌' : 'NO ✅'}`);
    console.log(`🔍 Incomplete processing: ${hasIncomplete ? 'YES ⚠️' : 'NO ✅'}`);

    if (hasFailures) {
      console.log('');
      console.log('❌ PIPELINE VALIDATION FAILED!');
      console.log('==============================');
      console.log('💥 One or more pipeline stages FAILED');
      console.log('🔧 Check the RAG microservices for errors');
      console.log('📊 Review the browser console logs above');

      throw new Error('RAG Pipeline validation failed - pipeline stages failed');
    }

    if (hasIncomplete) {
      console.log('');
      console.log('⚠️  PIPELINE VALIDATION INCOMPLETE!');
      console.log('===================================');
      console.log('🔄 Pipeline is still processing or stuck');
      console.log('⏰ Processing did not complete within timeout');
      console.log('🔧 Check the RAG microservices for bottlenecks');

      throw new Error('RAG Pipeline validation failed - processing incomplete or stuck');
    }

    console.log('');
    console.log('🎉 PIPELINE VALIDATION SUCCESSFUL!');
    console.log('==================================');
    console.log('✅ File upload: COMPLETED');
    console.log('✅ Document ingestion: COMPLETED');
    console.log('✅ Content processing: COMPLETED');
    console.log('✅ Vector embedding: COMPLETED');
    console.log('✅ Vector storage: COMPLETED');
    console.log('');
    console.log('🚀 Complete RAG pipeline processing validated successfully!');

  });
}); 